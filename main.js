// TODO:
// auto scale choice boxes
// make choices have circles around them
// make modal.header better
// make better quesion id getter
// make animations?
// make fullscreen?
// remove pdf button



(() => {
  const FONTS = {
    default: null,
    roboto: '"Roboto Flex", sans-serif',
    arial: 'Arial, sans-serif',
  };

  const store = { questions: {}, font: "default" };
  const questionState = { id: null, selected: null, solved: false, correctAnswer: null, wrong: new Set() };
  const choiceDataCache = new Map();
  let busy = false;
  let scheduleTimer = null;

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
    store.questions[questionState.id] = {
      wrong: Array.from(questionState.wrong),
      solved: questionState.solved,
      ts: Date.now()
    }
    chrome.storage.local.set({
      scb_questions: store.questions
    });
  }

  // deal with popup/modal

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
    return modal.header.textContent.replace("Question ID: ", "").replace("Close", "").trim();
  }

  function cleanUpQuestionModal(modal) {
    if (!modal.header || !modal.content || !modal.footer) return;

    const questionContent = modal.content.querySelector(".question-content");
    const answerContent = modal.content.querySelector(".answer-content");

    hideElement(answerContent.querySelector("h5"))

    questionContent.querySelector(".question").remove()
    questionContent.querySelector(".prompt").classList.remove("cb-margin-bottom-16")

    hideElement(modal.content.querySelector(".question-detail-info"));
    if (questionContent) hideElement(questionContent.querySelector(".text"));
    hideElements(modal.footer.querySelectorAll(".cb-checkbox"));
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
    const mainContainer = document.createElement("div");
    mainContainer.classList.add("scb-choice");
    mainContainer.answerChoice = letter
    const button = document.createElement("button");
    button.textContent = letters[index] + ". " + text;
    button.classList.add("scb-choice-button");
    if (questionState.wrong.has(letter)) {
      button.classList.add("scb-choice-incorrect", "scb-disable-interactions");
    } else if (questionState.solved && letter === questionState.correctAnswer) {
      button.classList.add("scb-choice-correct");
    }
    mainContainer.append(button);
    return mainContainer;
  }

  async function generateAnswerChoiceUi(modal, choiceData) {
    if (!modal.content) return;
    modal.content
      .querySelectorAll(".scb-choice, .scb-check-and-reset, .scb-rationale, .scb-question")
      .forEach((el) => el.remove());
    modal.content.querySelector(".answer-choices").classList.add("scb-hidden");
    const container = modal.content.querySelector(".answer-content");

    const question = document.createElement("h5")

    question.textContent = choiceData.question
    container.append(question)

    const answerChoiceElements = [];
    choiceData.choices.forEach((text, index) => {
      const element = generateAnswerChoiceElement(index, text);
      answerChoiceElements.push(element);
      container.append(element);
    });

    answerChoiceElements.forEach((element) => {
      const button = element.querySelector(".scb-choice-button");
      button.addEventListener("click", () => {
        if (questionState.solved) return;

        answerChoiceElements.forEach((elemen) => {
          elemen.querySelector(".scb-choice-button").classList.remove("scb-choice-selected");
        });

        button.classList.add("scb-choice-selected");
        questionState.selected = element;
      });
    });

    const checkAndResetContainer = document.createElement("div");
    checkAndResetContainer.classList.add("scb-check-and-reset");

    const checkbutton = document.createElement("button");
    checkbutton.textContent = "Check";
    checkbutton.classList.add("scb-check-button");

    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset question";
    resetButton.classList.add("scb-reset-button");

    checkAndResetContainer.append(checkbutton, resetButton);

    const rationaleContainer = document.createElement("div");
    rationaleContainer.classList.add("scb-rationale", "scb-hidden");

    const correctAnswer = document.createElement("h5");
    correctAnswer.textContent = choiceData.rationale.paragraphs[0];
    correctAnswer.classList.add("scb-correct-answer");
    const correctAnswerRationale = document.createElement("p");
    correctAnswerRationale.textContent = choiceData.rationale.paragraphs[1];
    correctAnswerRationale.classList.add("scb-correct-answer-rationale");
    const incorrectAnswersRationale = document.createElement("p");
    incorrectAnswersRationale.textContent  = choiceData.rationale.paragraphs[2].replace(/\s*(Choice\s+[A-D]\b)/g, "\n$1");
    incorrectAnswersRationale.classList.add("scb-incorrect-answer-rationale");

    rationaleContainer.append(correctAnswer, correctAnswerRationale, incorrectAnswersRationale);

    container.append(checkAndResetContainer, rationaleContainer);

    checkbutton.addEventListener("click", () => {
      if (questionState.solved) return;
      if (!questionState.selected) return;

      const choice = questionState.selected.answerChoice;
      const button = questionState.selected.querySelector(".scb-choice-button")
      if (!button) return;

      if (choice !== choiceData.rationale.correctAnswer) {
        button.classList.remove("scb-choice-selected");
        button.classList.add("scb-choice-incorrect", "scb-disable-interactions");
        questionState.selected = null;
        questionState.wrong.add(choice);
      } else {
        checkbutton.classList.add("scb-disable-interactions");
        button.classList.remove("scb-choice-selected");
        button.classList.add("scb-choice-correct", "scb-disable-interactions");
        answerChoiceElements.forEach((el) => {
          el.querySelector(".scb-choice-button").classList.add("scb-disable-interactions");
        });
        rationaleContainer.classList.remove("scb-hidden");
        questionState.selected = null;
        questionState.solved = true;
      }
      saveQuestions();
    });
    resetButton.addEventListener("click", () => {
      answerChoiceElements.forEach((elemen) => {
        elemen.querySelector(".scb-choice-button").classList.remove("scb-disable-interactions", "scb-choice-correct", "scb-choice-incorrect", "scb-choice-selected");
      });
      checkbutton.classList.remove("scb-disable-interactions");
      rationaleContainer.classList.add("scb-hidden");
      questionState.selected = null;
      questionState.solved = false;
      questionState.wrong = new Set();
      saveQuestions();
    });

    if (questionState.solved) {
      checkbutton.classList.add("scb-disable-interactions");
      rationaleContainer.classList.remove("scb-hidden");
      answerChoiceElements.forEach((element) => {
        element.querySelector(".scb-choice-button").classList.add("scb-disable-interactions");
      });
    }
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
      if (isModalLoading(modal)) return;

      const id = getQuestionId(modal);
      if (!id || id === questionState.id) return;

      saveQuestions()

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
      generateAnswerChoiceUi(modal, choiceData)
    } finally {
      busy = false
    }
  }

  function schedule() {
    clearTimeout(scheduleTimer)
    scheduleTimer = setTimeout(mainLoop, 100);
  }

  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.scb_font) {
      store.font = changes.scb_font.newValue
      applyFont();
    }
  });

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule()
})();
