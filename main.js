(() => {
  const FONTS = {
    default: null,
    roboto: '"Roboto Flex", sans-serif',
    arial: 'Arial, sans-serif',
  };

  const store = { questions: {}, font: "default", hideExport: 1 };
  const questionState = { id: null, isMultipleChoice: true, subject: null, selected: null, solved: false, correctAnswer: null, showedRationale: false, wrong: new Set() };
  const choiceDataCache = new Map();
  let spinnerOverlay = null;
  let busy = false;
  let scheduleTimer = null;
  let ignoreNextStorageChange = 0;

  // helper funcs

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitFor(func, timeout = 2000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = func();
      if (result) return result;
      await sleep(30);
    }
    return null;
  }

  function createElement(type, classes = "", textContent = "") {
    const element = document.createElement(type);
    if (classes) element.className = (classes + " scb-element").trim();
    if (textContent) element.textContent = textContent;
    return element;
  }

  function isOwnNode(node) {
    return node.nodeType == 1 && node.classList.contains("scb-element");
  }

  function hideElement(element) {
    if (element) element.classList.add("scb-hidden");
  }

  function hideElements(elements) {
    elements.forEach((element) => hideElement(element));
  }

  function applyFont() {
    const family = FONTS[store.font];
    const root = document.documentElement;
    if (family) {
      root.style.setProperty("--scb-font", family);
    } else {
      root.style.removeProperty("--scb-font");
    }
  }

  // saved data

  const saveReady = chrome.storage.local.get(["scb_questions", "scb_font", "scb_hide_export"]).then((data) => {
    store.questions = data.scb_questions || {};
    store.font = data.scb_font || "default";
    store.hideExport = data.scb_hide_export ?? 1;
    applyFont();
  });

  function saveQuestions() {
    if (!questionState.id) return;
    store.questions[questionState.id] = {
      isMultipleChoice: questionState.isMultipleChoice,
      wrong: Array.from(questionState.wrong),
      solved: questionState.solved,
      showedRationale: questionState.showedRationale,
      ts: Date.now()
    };
    ignoreNextStorageChange++;
    chrome.storage.local.set({ scb_questions: store.questions });
  }

  // handle popup/modal

  function findQuestionModal() {
    const root = document.getElementById("question-modal")
    if (!root) return null;
    return {
      root,
      header: root.querySelector(".cb-dialog-header"),
      content: root.querySelector(".cb-dialog-content"),
      footer: root.querySelector(".footer"),
    };
  }

  function isModalLoading(modal) {
    return (modal.content.querySelector(".spinner")) ? true : false
  }

  function getQuestionId(modal) {
    if (!modal.header) return null;
    const match = modal.header.textContent.match(/Question ID:\s*([A-Za-z0-9-]+)/i);
    return match ? match[1].replace(/close/i, "").trim() : null;
  }

  function generateHeading(modal) {
    const questionContent = modal.content.querySelector(".question-content");

    hideElement(modal.header.querySelector("h4")); // question id text

    modal.header.querySelectorAll(".scb-modal-heading").forEach((element) => { element.remove(); });

    questionContent.querySelector(".text")?.remove(); // subject text

    const heading = createElement("div", "scb-modal-heading");
    const difficulty = createElement("h4", "", questionContent.querySelector("h5").textContent);
    const questionId = createElement("p", "secondary-text", "id: " + questionState.id);

    heading.append(difficulty, questionId);
    modal.header.prepend(heading);

    hideElement(modal.content.querySelector(".question-detail-info")); // the big table
  }

  function cleanUpQuestionModal(modal) {
    if (!modal.header || !modal.content || !modal.footer) return;

    document.documentElement.classList.add("scb-no-scroll");

    modal.footer.classList.add("scb-remove-gap");

    const questionContent = modal.content.querySelector(".question-content");
    const answerContent = modal.content.querySelector(".answer-content");

    questionState.subject = questionContent.querySelector(".text")?.textContent;

    generateHeading(modal);

    hideElement(questionContent.querySelector("h5")); // difficulty
    questionContent.querySelector(".prompt")?.classList.remove("cb-margin-bottom-16"); // question text

    hideElement(answerContent.querySelector("h5")); // "answer" text

    // rationale toggle checkboxes
    if (questionContent) hideElement(questionContent.querySelector(".text"));
    hideElements(modal.footer.querySelectorAll(".cb-checkbox"));

    if (!modal.footer.querySelector(".scb-next-and-back")) {
      const nextButton = modal.footer.querySelector(".cb-align-right .cb-btn");
      const backButton = modal.footer.querySelector(".left-actions .cb-btn");
      if (nextButton && backButton) {
        const nextAndBackContainer = createElement("div", "scb-next-and-back");
        nextAndBackContainer.append(backButton, nextButton);
        modal.footer.append(nextAndBackContainer);
        hideElement(modal.footer.querySelector(".cb-align-right"));
        hideElement(modal.footer.querySelector(".left-actions"));
      }
    }

    hideElement(modal.footer.querySelector(".pdf-btn")); // hide pdf button
  }

  function createLoadingScreen() {
    const spinner = createElement("div", "scb-spinner");

    const offset = Math.floor(Math.random() * 6);

    for (let i = 0; i < 5; i++) {
      const segment = createElement("div", "scb-spinner-segment");
      segment.style.setProperty("--index", i + offset);

      spinner.append(segment);
    }

    return spinner;
  }

  function showSpinner() {
    if (spinnerOverlay) return;
    spinnerOverlay = createElement("div", "scb-spinner-overlay");
    spinnerOverlay.append(createLoadingScreen());

    ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"].forEach((type) => {
      spinnerOverlay.addEventListener(type, (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    });

    document.body.append(spinnerOverlay);
  }

  function hideSpinner() {
    spinnerOverlay?.remove();
    spinnerOverlay = null;
  }

  // answer choices

  function getChoices(modal) {
    if (!modal.content) return null;
    const div = modal.content.querySelector(".answer-choices");
    if (!div) return null;
    const lis = div.querySelectorAll("li");
    const choices = [];
    lis.forEach((li) => { choices.push(li.textContent) });
    return choices;
  }

  async function getRationale(modal) {
    if (!modal.footer) return null;
    const checkbox = modal.footer.querySelector('input[type="checkbox"]');
    if (!checkbox) return null;

    if (!checkbox.checked) checkbox.click();
    const div = await waitFor(() => modal.root.querySelector(".rationale"));
    const paragraphs = div ? [...div.querySelectorAll("p")].map((p) => p.textContent.trim()) : null;
    if (!paragraphs) return null;
    let correctAnswer = paragraphs ? paragraphs[0].replace(/^Correct Answer:\s*/i, "").trim() : null;
    if (correctAnswer.includes(", ")) correctAnswer = correctAnswer.split(", ").map((answer) => typeof answer == "string" ? answer.trim() : answer);
    if (checkbox.checked) checkbox.click();

    return { correctAnswer, paragraphs };
  }

  function getQuestion(modal) {
    if (!modal.content) return null;
    const div = modal.content.querySelector(".question")
    const question = div ? div.querySelector("p").textContent : null;
    return question
  }

  async function getChoiceData(modal) {
    const choices = getChoices(modal);
    const rationale = await getRationale(modal);
    const question = getQuestion(modal);
    return { choices, rationale, question, isMultipleChoice: !!(choices && choices.length > 0) };
  }

  function generateAnswerChoiceElement(index, text) {
    const letters = ["A", "B", "C", "D"];
    let letter = letters[index];
    if (!letter) letter = "?"

    const button = createElement("button", "scb-choice-button");
    button.dataset.answerChoice = letter;
    const badge = createElement("span", "scb-choice-letter", letter);
    const label = createElement("span", "scb-choice-text", text);

    button.append(badge, label)

    if (questionState.wrong.has(letter)) {
      button.classList.add("scb-choice-incorrect", "scb-disable-interactions");
    } else if (questionState.solved && letter === questionState.correctAnswer) {
      button.classList.add("scb-choice-correct");
    }

    return button;
  }

  function generateAnswerFieldElement() {
    const element = createElement("input", "scb-answer-field");
    element.type = "text";
    if (questionState.solved) {
      element.value = Array.isArray(questionState.correctAnswer) ? questionState.correctAnswer.join(", ") : questionState.correctAnswer;
      element.classList.add("scb-choice-correct");
    }
    return element;
  }

  function showRationale(container, animate = true) {
    container.classList.remove("scb-hidden");
    if (!animate) {
      container.classList.add("scb-rationale-animating", "scb-no-anim");
      return;
    }
    void container.offsetWidth;
    requestAnimationFrame(() => container.classList.add("scb-rationale-animating"));
  }

  function hideRationale(container) {
    container.classList.remove("scb-rationale-animating", "scb-no-anim");
    container.classList.add("scb-hidden");
  }

  function scrollModalToTop(modal) {
    const targets = [
      modal.content,
      modal.content.querySelector(".question-info"),
      modal.content.querySelector(".answer-content"),
      modal.root.querySelector(".cb-modal-container"),
    ];
    targets.forEach((element) => {
      if (element) element.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  async function generateAnswerChoiceUi(modal, choiceData) {
    if (!modal.content) return;

    modal.content
      .querySelectorAll(".scb-question, .scb-choice-button, .scb-answer-field, .scb-check-reset-show-rationale, .scb-rationale")
      .forEach((element) => element.remove());

    hideElement(modal.content.querySelector(".answer-choices"));

    const container = modal.content.querySelector(".answer-content");

    // question

    if (questionState.subject == "Reading and Writing") {
      hideElement(modal.content.querySelector(".question"));
      const question = createElement("h5", "scb-question", choiceData.question);
      container.append(question)
    }

    // choices

    const answerChoiceInputs = [];
    if (questionState.isMultipleChoice) {
      choiceData.choices.forEach((text, i) => {
        const element = generateAnswerChoiceElement(i, text);
        answerChoiceInputs.push(element);
        container.append(element);
      });
      answerChoiceInputs.forEach((button) => {
      button.addEventListener("click", () => {
        if (questionState.solved) return;

        answerChoiceInputs.forEach((btn) => {
          btn.classList.remove("scb-choice-selected");
        });

        button.classList.add("scb-choice-selected");
        questionState.selected = button;
      });
    });
    } else {
      const element = generateAnswerFieldElement();
      answerChoiceInputs.push(element);
      container.append(element);
      questionState.selected = element;
    }

    // check and reset

    const checkResetShowRationaleContainer = createElement("div", "scb-check-reset-show-rationale");

    const checkbutton = createElement("button", "scb-check-button", "Check");
    const resetButton = createElement("button", "scb-reset-button", "Reset question");
    const showRationaleButton = questionState.isMultipleChoice
      ? null
      : createElement("button", "scb-reset-button", "Show Rationale");

    checkResetShowRationaleContainer.append(checkbutton, resetButton);
    if (showRationaleButton) checkResetShowRationaleContainer.append(showRationaleButton);

    // rationale

    const rationaleContainer = createElement("div", "scb-rationale scb-hidden");
    const correctAnswer = createElement("h5", "scb-correct-answer", choiceData.rationale.paragraphs[0]);
    const correctAnswerRationale = createElement("p", "scb-correct-answer-rationale", choiceData.rationale.paragraphs[1]);
    const incorrectAnswersRationale = choiceData.rationale.paragraphs[2]
      ? createElement("p", "scb-incorrect-answer-rationale", choiceData.rationale.paragraphs[2].replace(/\s*(Choice\s+[A-D]\b)/g, "\n$1").trim())
      : null;

    const pieces = [correctAnswer, correctAnswerRationale, incorrectAnswersRationale].filter(Boolean)
    pieces.forEach((element, i) => element.style.setProperty("--index", i));
    rationaleContainer.append(...pieces);

    container.append(checkResetShowRationaleContainer, rationaleContainer);

    checkbutton.addEventListener("click", () => {
      if (questionState.solved) return;
      if (!questionState.selected) return;

      const input = questionState.selected;

      let answer = null;
      if (questionState.isMultipleChoice) {
        answer = input.dataset.answerChoice;
      } else {
        answer = input.value.trim();
      }

      const correct = Array.isArray(questionState.correctAnswer) ? questionState.correctAnswer.includes(answer) : answer == questionState.correctAnswer

      if (!correct) {
        input.classList.remove("scb-choice-selected");
        input.classList.add("scb-choice-incorrect", "scb-disable-interactions");
        if (questionState.isMultipleChoice) {
          questionState.selected = null;
          questionState.wrong.add(answer);
        }
      } else {
        showRationale(rationaleContainer);
        checkbutton.classList.add("scb-disable-interactions");
        if (showRationaleButton) showRationaleButton.classList.add("scb-disable-interactions");
        input.classList.remove("scb-choice-selected");
        input.classList.add("scb-choice-correct");
        answerChoiceInputs.forEach((input) => {
          input.classList.add("scb-disable-interactions");
        });
        rationaleContainer.classList.remove("scb-hidden");
        if (questionState.isMultipleChoice) { questionState.selected = null; }
        questionState.solved = true;
      }
      saveQuestions();
    });
    resetButton.addEventListener("click", () => {
      hideRationale(rationaleContainer);
      answerChoiceInputs.forEach((input) => {
        input.classList.remove("scb-disable-interactions", "scb-choice-correct", "scb-choice-incorrect", "scb-choice-selected");
      });
      checkbutton.classList.remove("scb-disable-interactions");
      if (showRationaleButton) showRationaleButton.classList.remove("scb-disable-interactions");
      rationaleContainer.classList.add("scb-hidden");
      if (questionState.isMultipleChoice) { questionState.selected = null; }
      questionState.solved = false;
      questionState.wrong = new Set();
      questionState.showedRationale = false;
      saveQuestions();
    });
    if (showRationaleButton) showRationaleButton.addEventListener("click", () => {
      showRationale(rationaleContainer);

      const input = questionState.selected;

      checkbutton.classList.add("scb-disable-interactions");
      showRationaleButton.classList.add("scb-disable-interactions");
      input.classList.remove("scb-choice-selected");
      input.classList.add("scb-choice-correct");
      answerChoiceInputs.forEach((input) => {
        input.classList.add("scb-disable-interactions");
      });
      rationaleContainer.classList.remove("scb-hidden");
      const shownAnswer = Array.isArray(questionState.correctAnswer) ? questionState.correctAnswer.join(", ") : questionState.correctAnswer;
      input.value = shownAnswer;
      questionState.solved = true;
      questionState.showedRationale = true;

      saveQuestions();
    });

    if (questionState.solved) {
      showRationale(rationaleContainer, false);
      checkbutton.classList.add("scb-disable-interactions");
      if (showRationaleButton) showRationaleButton.classList.add("scb-disable-interactions");
      rationaleContainer.classList.remove("scb-hidden");
      answerChoiceInputs.forEach((input) => {
        input.classList.add("scb-disable-interactions");
      });
    }

    scrollModalToTop(modal);
    hideSpinner();
  }

  // table editing

  function getTable() {
    const root = document.getElementById("questions-table");
    if (!root) return null;
    return {
      header: root.querySelector("thead")?.querySelector("tr"),
      rows: [...root.querySelectorAll("tbody tr")]
    };
  }

  function getRowState(saved) {
    if (!saved) return 0;
    if (!saved.solved) return 0;
    if (saved.showedRationale) return 5;
    if (!saved.isMultipleChoice) return 4;
    const wrong = saved.wrong?.length ?? 0;
    if (wrong === 0) return 1;
    if (wrong >= 3) return 3;
    return 2;
  }

  function updateTable(table) {
    if (!table.header || !table.rows) return;

    const headerId = table.header.querySelector(".id-column");
    if (headerId && !table.header.querySelector(".scb-table-column")) {
      const th = createElement("th", "scb-table-column", "SCB");
      headerId.insertAdjacentElement("afterend", th);
    }

    const colors = ["--scb-light-gray", "--scb-green-tint1", "--scb-yellow-tint1", "--scb-red-tint1", "--scb-green-tint1", "--scb-red-tint1"];
    const labels = ["Unsolved", "First Try", "Retried", "Last Try", "Solved", "Rationale"];

    table.rows.forEach((row) => {
      const idCell = row.querySelector(".id-column");
      if (!idCell) return;

      const id = idCell.textContent.trim();
      const state = getRowState(store.questions[id]);

      let cell = row.querySelector(".scb-table-column");
      if (!cell) {
        cell = createElement("td", "scb-table-column");
        idCell.insertAdjacentElement("afterend", cell);
      }

      if (cell.dataset.id === id && cell.dataset.state === String(state)) return;

      cell.dataset.id = id;
      cell.dataset.state = String(state);
      cell.replaceChildren();

      const background = createElement("div", "scb-table-background", labels[state]);
      background.style.setProperty("--color", `var(${colors[state]})`);

      cell.append(background);
    });
  }

  // base site

  function updateHeroBand() {
    const heroBand = document.querySelector(".eqb-hero-band");
    if (!heroBand) return;

    const h1 = heroBand.querySelector("h1");
    if (!h1) return;
    if (h1 && h1.textContent == "SAT Clean Bank") return;
    h1.textContent = "SAT Clean Bank";
    h1.classList.add("scb-remove-margin");

    const p = heroBand.querySelector("p");
    if (p) p.remove();
  }

  function getExportElements() {
    const elements = [
      document.getElementById("export-button"),
      document.querySelector(".question-table-toggle"),
    ];

    const table = getTable();
    if (table) {
      elements.push(table.header?.querySelector(".checked-column"));
      table.rows.forEach((row) => elements.push(row.querySelector(".checked-column")));
    }

    return elements.filter(Boolean);
  }

  function updateExportElements() {
    const hide = Number(store.hideExport) === 1;
    getExportElements().forEach((element) => {
      if (element.classList.contains("scb-hidden") !== hide) {
        element.classList.toggle("scb-hidden", hide);
      }
    });
  }

  // main loop

  async function mainLoop() {
    if (busy) return;
    try {
      busy = true;
      await saveReady;
      const modal = findQuestionModal();
      if (!modal) {
        questionState.id = null;
        return;
      }

      const id = getQuestionId(modal);
      if (!id || id === questionState.id) return;

      if (isModalLoading(modal)) return;

      let choiceData = choiceDataCache.get(id);
      if (!choiceData) {
        choiceData = await getChoiceData(modal);
        choiceDataCache.set(id, choiceData);
      }

      const saved = store.questions[id];

      questionState.id = id;
      questionState.isMultipleChoice = choiceData.isMultipleChoice;
      questionState.selected = null;
      questionState.solved = saved?.solved ?? false;
      questionState.showedRationale = saved?.showedRationale ?? false;
      questionState.correctAnswer = choiceData.rationale.correctAnswer;
      questionState.wrong = new Set(saved?.wrong ?? []);

      cleanUpQuestionModal(modal);
      generateAnswerChoiceUi(modal, choiceData);
    } catch (err) {
      console.error("[scb] mainloop:", err);
      hideSpinner();
    } finally {
      busy = false
    }
  }

  async function handleModalChange() {
    try {
      updateHeroBand();
    } catch (err) {
      console.error("[scb] heroband:", err);
    }

    try {
      const table = getTable();
      if (table) updateTable(table);
      if (questionState.id == null) updateExportElements();
    } catch (err) {
      console.error("[scb] table:", err);
    }

    const modal = findQuestionModal();
    if (!modal) {
      document.documentElement.classList.remove("scb-no-scroll");
      if (spinnerOverlay) hideSpinner();
      return;
    }

    const loading = isModalLoading(modal);
    const id = getQuestionId(modal);

    if (loading || (id && id !== questionState.id)) {
      showSpinner();
    }
  }

  function schedule() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(mainLoop, 100);
  }

  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.scb_font) {
      store.font = changes.scb_font.newValue
      applyFont();
    }

    if (changes.scb_questions) {
      if (ignoreNextStorageChange) {
        ignoreNextStorageChange--;
        return;
      }
      store.questions = changes.scb_questions.newValue ?? {};
      questionState.id = null;
      schedule();
      handleModalChange();
    }

    if (changes.scb_hide_export) {
      store.hideExport = changes.scb_hide_export.newValue
      getExportElements();
      updateExportElements();
    }
  });

  new MutationObserver((mutations) => {
    const external = mutations.some((mutation) => {
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (target?.closest(".scb-element")) return false;

      if (mutation.type === "characterData") return true;

      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (nodes.length === 0) return true;
      return !nodes.every(isOwnNode);
    });

    if (!external) return;

    schedule();
    handleModalChange();
  }).observe(
    document.body,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );
  schedule();
})();
