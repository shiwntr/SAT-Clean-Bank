(() => {
  const FONTS = {
    default: null,
    roboto: '"Roboto Flex", sans-serif',
    arial: 'Arial, sans-serif',
  };

  const store = { questions: {}, font: "default" };
  const questionState = { id: null, selected: null, solved: false, correctAnswer: null, wrong: new Set() };
  const choiceDataCache = new Map();
  let spinnerOverlay = null;
  let busy = false;
  let scheduleTimer = null;
  let ignoreNextStorageChange = false;

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

  function findTextNodes(root, get = false, testFunc) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      if (get) {
        out.push(node.nodeValue.trim());
      }
      else if (testFunc(node.nodeValue.trim())) {
        out.push(node);
      }
    }
    return out;
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

  const saveReady = chrome.storage.local.get(["scb_questions", "scb_font"]).then((data) => {
    store.questions = data.scb_questions || {};
    store.font = data.scb_font || "default";
    applyFont();
  });

  function saveQuestions() {
    if (!questionState.id) return;
    store.questions[questionState.id] = {
      wrong: Array.from(questionState.wrong),
      solved: questionState.solved,
      ts: Date.now()
    };
    ignoreNextStorageChange = true;
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

    const heading = document.createElement("div");
    heading.classList.add("scb-modal-heading");

    const difficulty = document.createElement("h4");
    difficulty.textContent = questionContent.querySelector("h5").textContent;

    const questionId = document.createElement("p");
    questionId.textContent = "id: " + questionState.id;
    questionId.classList.add("secondary-text");

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

    generateHeading(modal);

    hideElement(questionContent.querySelector("h5")); // difficulty
    questionContent.querySelector(".prompt")?.classList.remove("cb-margin-bottom-16"); // question text
    hideElement(questionContent.querySelector(".question")); // actual question

    hideElement(answerContent.querySelector("h5")); // "answer" text

    // rationale toggle checkboxes
    if (questionContent) hideElement(questionContent.querySelector(".text"));
    hideElements(modal.footer.querySelectorAll(".cb-checkbox"));

    if (!modal.footer.querySelector(".scb-next-and-back")) {
      const nextButton = modal.footer.querySelector(".cb-align-right .cb-btn");
      const backButton = modal.footer.querySelector(".left-actions .cb-btn");
      if (nextButton && backButton) {
        const nextAndBackContainer = document.createElement("div");
        nextAndBackContainer.classList.add("scb-next-and-back");
        nextAndBackContainer.append(backButton, nextButton);
        modal.footer.append(nextAndBackContainer);
        hideElement(modal.footer.querySelector(".cb-align-right"));
        hideElement(modal.footer.querySelector(".left-actions"));
      }
    }

    hideElement(modal.footer.querySelector(".pdf-btn")); // hide pdf button
  }

  function createLoadingScreen() {
    const spinner = document.createElement("div");
    spinner.classList.add("scb-spinner");
    for (let i = 0; i < 5; i++) {
      const segment = document.createElement("div");
      segment.classList.add("scb-spinner-segment");
      segment.style.setProperty("--index", i);
      spinner.append(segment);
    }
    return spinner;
  }

  function showSpinner() {
    if (spinnerOverlay) return;
    spinnerOverlay = document.createElement("div");
    spinnerOverlay.classList.add("scb-spinner-overlay");
    spinnerOverlay.append(createLoadingScreen());
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
    lis.forEach((li) => {
      const textSegments = findTextNodes(li, true);
      let choice = "";
      textSegments.forEach((segment) => {
        choice += segment;
        if (/^\p{P}$/u.test(segment)) choice += " ";
      });
      choices.push(choice);
    });
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
    const correctAnswer = paragraphs ? paragraphs[0].replace(/^Correct Answer:\s*/i, "").trim() : null;
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
    return { choices, rationale, question };
  }

  function generateAnswerChoiceElement(index, text) {
    const letters = ["A", "B", "C", "D"];
    let letter = letters[index];
    if (!letter) letter = "?"

    const button = document.createElement("button");
    button.classList.add("scb-choice-button");
    button.dataset.answerChoice = letter
    const badge = document.createElement("span");
    badge.classList.add("scb-choice-letter");
    badge.textContent = letter;
    const label = document.createElement("span");
    label.classList.add("scb-choice-text");
    label.textContent = text;

    button.append(badge, label)

    if (questionState.wrong.has(letter)) {
      button.classList.add("scb-choice-incorrect", "scb-disable-interactions");
    } else if (questionState.solved && letter === questionState.correctAnswer) {
      button.classList.add("scb-choice-correct");
    }

    return button;
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

  async function generateAnswerChoiceUi(modal, choiceData) {
    if (!modal.content) return;

    modal.content
      .querySelectorAll(".scb-question, .scb-choice-button, .scb-check-and-reset, .scb-rationale, .scb-question")
      .forEach((element) => element.remove());

    hideElement(modal.content.querySelector(".answer-choices"));

    const container = modal.content.querySelector(".answer-content");

    // quesiton

    const question = document.createElement("h5")
    question.textContent = choiceData.question
    question.classList.add("scb-question")
    container.append(question)

    // choices

    const answerChoiceButtonss = [];
    choiceData.choices.forEach((text, i) => {
      const element = generateAnswerChoiceElement(i, text);
      answerChoiceButtonss.push(element);
      container.append(element);
    });
    answerChoiceButtonss.forEach((button) => {
      button.addEventListener("click", () => {
        if (questionState.solved) return;

        answerChoiceButtonss.forEach((btn) => {
          btn.classList.remove("scb-choice-selected");
        });

        button.classList.add("scb-choice-selected");
        questionState.selected = button;
      });
    });

    // check and reset

    const checkAndResetContainer = document.createElement("div");
    checkAndResetContainer.classList.add("scb-check-and-reset");

    const checkbutton = document.createElement("button");
    checkbutton.textContent = "Check";
    checkbutton.classList.add("scb-check-button");
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset question";
    resetButton.classList.add("scb-reset-button");

    checkAndResetContainer.append(checkbutton, resetButton);

    // rationale

    const rationaleContainer = document.createElement("div");
    rationaleContainer.classList.add("scb-rationale", "scb-hidden");

    const correctAnswer = document.createElement("h5");
    correctAnswer.textContent = choiceData.rationale.paragraphs[0];
    correctAnswer.classList.add("scb-correct-answer");
    const correctAnswerRationale = document.createElement("p");
    correctAnswerRationale.textContent = choiceData.rationale.paragraphs[1];
    correctAnswerRationale.classList.add("scb-correct-answer-rationale");
    const incorrectAnswersRationale = document.createElement("p");
    incorrectAnswersRationale.textContent  = choiceData.rationale.paragraphs[2].replace(/\s*(Choice\s+[A-D]\b)/g, "\n$1").trim();
    incorrectAnswersRationale.classList.add("scb-incorrect-answer-rationale");

    [correctAnswer, correctAnswerRationale, incorrectAnswersRationale].forEach((element, i) => element.style.setProperty("--index", i));

    rationaleContainer.append(correctAnswer, correctAnswerRationale, incorrectAnswersRationale);

    container.append(checkAndResetContainer, rationaleContainer);

    checkbutton.addEventListener("click", () => {
      if (questionState.solved) return;
      if (!questionState.selected) return;

      const button = questionState.selected;
      const choice = button.dataset.answerChoice;

      if (choice !== choiceData.rationale.correctAnswer) {
        button.classList.remove("scb-choice-selected");
        button.classList.add("scb-choice-incorrect", "scb-disable-interactions");
        questionState.selected = null;
        questionState.wrong.add(choice);
      } else {
        showRationale(rationaleContainer);
        checkbutton.classList.add("scb-disable-interactions");
        button.classList.remove("scb-choice-selected");
        button.classList.add("scb-choice-correct", "scb-disable-interactions");
        answerChoiceButtonss.forEach((button) => {
          button.classList.add("scb-disable-interactions");
        });
        rationaleContainer.classList.remove("scb-hidden");
        questionState.selected = null;
        questionState.solved = true;
      }
      saveQuestions();
    });
    resetButton.addEventListener("click", () => {
      hideRationale(rationaleContainer);
      answerChoiceButtonss.forEach((button) => {
        button.classList.remove("scb-disable-interactions", "scb-choice-correct", "scb-choice-incorrect", "scb-choice-selected");
      });
      checkbutton.classList.remove("scb-disable-interactions");
      rationaleContainer.classList.add("scb-hidden");
      questionState.selected = null;
      questionState.solved = false;
      questionState.wrong = new Set();
      saveQuestions();
    });

    if (questionState.solved) {
      showRationale(rationaleContainer);
      checkbutton.classList.add("scb-disable-interactions");
      rationaleContainer.classList.remove("scb-hidden");
      answerChoiceButtonss.forEach((button) => {
        button.classList.add("scb-disable-interactions");
      });
    }

    hideSpinner();
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
      questionState.selected = null;
      questionState.solved = saved?.solved ?? false;
      questionState.correctAnswer = choiceData.rationale.correctAnswer
      questionState.wrong = new Set(saved?.wrong ?? []);

      cleanUpQuestionModal(modal);
      generateAnswerChoiceUi(modal, choiceData);
    } catch (err) {
      console.error("error:", err);
      hideSpinner();
    } finally {
      busy = false
    }
  }

  async function handleModalChange() {
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
        ignoreNextStorageChange = false;
        return;
      }
      store.questions = changes.scb_questions.newValue ?? {};
      questionState.id = null;
      schedule();
    }
  });

  new MutationObserver((mutations) => {
      schedule();
      handleModalChange();
  }).observe(
    document.body,
    {
      childList: true,
      subtree: true,
      characterData: true
    });
  schedule();
})();
