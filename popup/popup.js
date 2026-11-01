(() => {
  const FONT_VALUES = ["default", "roboto", "arial"];
  const FONT_NAMES = ["Default", "Roboto", "Arial"];

  const store = { questions: {}, font: "default", date: new Date() };

  const views = document.getElementById("views");
  const settings = document.getElementById("settings")
  const content = document.getElementById("content")

  const stats = document.getElementById("stats")
  const questionsAnsweredElement = stats.querySelector(".questions-answered")
  const firstAttemptElement = stats.querySelector(".first-attempt")
  const questionStateBarElement = stats.querySelector(".question-stats")

  const countdown = document.getElementById("countdown");
  const dayElement = countdown.querySelector(".days");
  const hourElement = countdown.querySelector(".hours");
  const minuteElement = countdown.querySelector(".minutes");
  const secondElement = countdown.querySelector(".seconds");

  const openCalendarButton = document.getElementById("open-calendar")
  const testingDayElement = document.getElementById("testing-day")
  const calendar = document.getElementById("calendar")

  const resetButton = document.getElementById("reset-btn");
  const importButton = document.getElementById("import-data");
  const importFile = document.getElementById("import-file");
  let resetTimer = null;
  let resetDataClicks = 0;

  // settings

  function showView(showSettings) {
    const startHeight = views.offsetHeight;

    // toggle visibility
    settings.style.display = showSettings ? "block" : "none";
    content.style.display = showSettings ? "none" : "block";
    views.style.height = "auto";
    const endHeight = views.offsetHeight;

    const incoming = showSettings ? settings : content;
    incoming.animate(
      [
        { opacity: 0 },
        { opacity: 1 }
      ],
      {
        duration: 500,
        easing: "ease"
      }
    ); // opacity

    if (startHeight === endHeight) {
      views.style.height = "";
      return;
    }

    // height
    views.style.height = `${startHeight}px`;
    void views.offsetHeight;
    views.classList.add("animating");
    void views.offsetHeight;
    views.style.height = `${endHeight}px`;

    // cleanup after transition
    views.addEventListener("transitionend", function done(e) {
      if (e.target !== views) return;
      views.removeEventListener("transitionend", done);
      views.classList.remove("animating");
      views.style.height = "";
    });
  }
  const settingsButton = document.getElementById("settings-btn");
  let settingsOpen = false;
  settingsButton.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    showView(settingsOpen);
  });
  const fontDropdown = document.getElementById("font-dropdown");

  // saved data

  const saveReady = chrome.storage.local.get(["scb_questions", "scb_font", "scb_date"]).then((data) => {
    store.questions = data.scb_questions || {};
    store.font = data.scb_font || "default";
    store.date = data.scb_date ? new Date(data.scb_date) : new Date();
  });

  document.getElementById("reset-btn").addEventListener("click", function () {
    if (resetDataClicks === 0) {
      resetDataClicks = 1;
      resetButton.textContent = "Are you sure?";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetDataClicks = 0;
        resetButton.textContent = "Reset Data";
      }, 3000);
      return;
    }
    if (resetDataClicks === 1) {
      resetDataClicks = 2;
      resetButton.textContent = "ARE YOU REALLY SURE?";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetDataClicks = 0;
        resetButton.textContent = "Reset Data";
      }, 3000);
      return;
    }

    const date = new Date();

    chrome.storage.local.remove("scb_questions");
    chrome.storage.local.set({
      scb_font: "default",
      scb_date: date.getTime()
    });

    store.questions = {};

    store.date = date;
    updateStats();
    updateCountdown();
    updateDateLabel();

    fontDropdown.querySelector(".dropdown-toggle").textContent = "Default";
    fontDropdown.dataset.value = "default"
    resetButton.textContent = "Data reset";
    resetDataClicks = 0;
    clearTimeout(resetTimer);
    setTimeout(() => { resetButton.textContent = "Reset Data"; }, 3000);
  });

  document.getElementById("export-data").addEventListener("click", async () => {
    const data = await chrome.storage.local.get(["scb_questions", "scb_font", "scb_date"]);
    const payload = {
      scb_questions: data.scb_questions ?? {},
      scb_font: data.scb_font ?? "default",
      scb_date: data.scb_date
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scb-data.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Bad file 1");

      const questions = parsed.scb_questions;
      if (typeof questions !== "object" || questions === null || Array.isArray(questions)) throw new Error("Bad file 2");
      store.questions = questions;

      store.font = FONT_VALUES.includes(parsed.scb_font) ? parsed.scb_font : "default";
      const importedDate = Number.isFinite(parsed.scb_date) ? new Date(parsed.scb_date) : null;
      store.date = importedDate ?? store.date;

      updateStats();
      updateCountdown();
      updateDateLabel();

      await chrome.storage.local.set({
        scb_questions: store.questions,
        scb_font: store.font,
        scb_date: store.date.getTime()
      });

      fontDropdown.dataset.value = store.font;
      const toggle = fontDropdown.querySelector(".dropdown-toggle");
      if (toggle) toggle.textContent = FONT_NAMES[FONT_VALUES.indexOf(store.font)];

      importButton.textContent = "Imported";
    } catch (err) {
      importButton.textContent = err;
    }
    setTimeout(() => { importButton.textContent = "Import Data"; }, 1500);
    importFile.value = "";
  });

  // helper funcs

  function makeDropdownMenu(container, name, optionNames, optionValues, value, saveValue) {
    container.dataset.value = value;

    const nameText = document.createElement("p");
    nameText.textContent = name;

    const toggleButton = document.createElement("button");
    toggleButton.classList.add("dropdown-toggle");
    toggleButton.textContent = optionNames[optionValues.indexOf(value)];

    const dropdownMenu = document.createElement("div");
    dropdownMenu.classList.add("dropdown-menu");

    toggleButton.addEventListener("click", (event) => {
      toggleButton.classList.toggle("dropdown-toggle-down");
      dropdownMenu.classList.toggle("show");
      event.stopPropagation();
    });

    window.addEventListener("click", () => {
      toggleButton.classList.remove("dropdown-toggle-down");
      dropdownMenu.classList.remove("show");
    })

    container.append(nameText, toggleButton, dropdownMenu);

    optionNames.forEach((optionName, index) => {
      const option = document.createElement("button");
      option.classList.add("dropdown-item");
      option.textContent = optionName;
      if (index == optionNames.length - 1) option.classList.add("dropdown-last-item");

      option.addEventListener("click", () => {
        toggleButton.textContent = option.textContent;
        container.dataset.value = optionValues[index];
        if (saveValue) chrome.storage.local.set({ [saveValue]: optionValues[index] });
      });

      dropdownMenu.append(option);
    });
  }
  function makeCounter(container, startValue, numDigits = 1) {
    const value = startValue;
    const columns = [];
    let digits = String(Math.max(0, Math.floor(value)))
      .padStart(numDigits, "0")
      .split("")
      .map(Number);

    function makeColumn(value) {
      const column = document.createElement("span");
      column.classList.add("counter-digit")

      const strip = document.createElement("span");
      strip.classList.add("counter-strip");
      for (let i = 0; i <= 9; i++) {
        const digit = document.createElement("span");
        digit.textContent = i;
        strip.append(digit);
      }
      column.append(strip);
      return column;
    }

    function set(value) {
      digits = String(Math.max(0, Math.floor(value)))
        .padStart(numDigits, "0")
        .split("")
        .map(Number);

      while (columns.length < digits.length) {
        const column = makeColumn();
        container.prepend(column);
        columns.unshift(column);
        void column.offsetWidth;
      }

      while (columns.length > Math.max(digits.length, numDigits)) {
        columns.shift().remove();
      }

      digits.forEach((digit, i) => {
        columns[i].firstChild.style.transform = `translateY(${-digit * 10}%)`;
      });
    }

    set(startValue);
    return { value, set };
  }
  function makeBar(container, values) {
    const entries = Object.entries(values);

    const segments = [];
    const descriptionValues = [];

    const percentSizes = {};

    let total = 0;

    function updatePercentValues() {
      total = 0;
      Object.values(values).forEach((value) => {
        total += value[0]
      });
      for (const [key, value] of Object.entries(values)) {
        percentSizes[key] = total > 0 ? (value[0] / total) * 100 : 0;
      };
    }

    updatePercentValues();

    function makeSegment(name, data) {
      const segment = document.createElement("div");
      segment.classList.add("bar-segment");
      segment.dataset.name = name;
      segment.style.width = `${percentSizes[name]}%`;
      segment.style.backgroundColor = `var(${data[1]})`
      segments.push(segment);
      container.append(segment);
    };
    function makeDescription(name, data, isLast = false) {
      const description = document.createElement("div");
      description.classList.add("bar-description");
      if (isLast) description.classList.add("bar-last-description");

      const colorBox = document.createElement("div");
      colorBox.classList.add("bar-description-color");
      colorBox.style.backgroundColor = `var(${data[1]})`;

      const text = document.createElement("p");
      text.classList.add("bar-description-text");
      text.textContent = name;

      const value = document.createElement("p");
      value.classList.add("bar-description-value");
      value.textContent = `${Math.floor(percentSizes[name])}% - ${data[0]}`;
      descriptionValues.push(value);

      description.append(colorBox, text, value);
      container.parentNode.append(description);
    }

    entries.forEach(([key, data], index) => {
      makeSegment(key, data);
      makeDescription(key, data, index === entries.length - 1);
    });

    function updateAll() {
      updatePercentValues();
      segments.forEach((element) => {
        element.style.width = `${percentSizes[element.dataset.name]}%`;
      });
      descriptionValues.forEach((element, i) => {
        const name = Object.keys(values)[i];
        element.textContent = `${Math.floor(percentSizes[name])}% - ${values[name][0]}`;
      });
    }

    function setValue(valueName, value) {
      values[valueName][0] = value;
      updateAll();
    }

    return { values, setValue, updateAll }
  }

  // question bank button

  document.getElementById("qb-btn").addEventListener("click", function () {
    window.open("https://satsuiteeducatorquestionbank.collegeboard.org/digital/search", "_blank");
  });

  // date setting

  openCalendarButton.addEventListener("click", () => {
    calendar.showPicker();
  });
  calendar.addEventListener("change", () => {
    const date = new Date(calendar.value);
    if (isNaN(date)) return;

    store.date = date;
    chrome.storage.local.set({ scb_date: date.getTime() });

    updateCountdown();
    updateDateLabel();
  })

  // stats

  function getStats() {
    const stats = { total: 0, answered: 0, answeredFirst: 0, answeredMiddle: 0, answeredLast: 0, unsolved: 0 };
    Object.values(store.questions).forEach((question) => {
      stats.total++;
      if (question.solved) {
        stats.answered++;
        const wrongCount = question.wrong?.length ?? 0;
        if (wrongCount == 0) {
          stats.answeredFirst++;
          return
        }
        if (wrongCount >= 3) {
          stats.answeredLast++;
          return
        }
        stats.answeredMiddle++;
      } else {
        stats.unsolved++;
      }
    });
    return stats
  }

  function updateStats() {
    const statsData = getStats();
    questionsAnsweredCounter.set(statsData.answered);

    firstAttemptCounter.set((statsData.answeredFirst / statsData.total) * 100);

    questionStateBar.setValue("First Attempt", statsData.answeredFirst);
    questionStateBar.setValue("Retried", statsData.answeredMiddle);
    questionStateBar.setValue("Last Attempt", statsData.answeredLast);
    questionStateBar.setValue("Left Unsolved", statsData.unsolved);
  }

  // main loop

  const questionsAnsweredCounter = makeCounter(questionsAnsweredElement, 0);
  const firstAttemptCounter = makeCounter(firstAttemptElement, 0);
  const questionStateBar = makeBar(
    questionStateBarElement,
    {
      "First Attempt": [0, "--scb-green"],
      "Retried": [0, "--scb-yellow"],
      "Last Attempt": [0, "--scb-red"],
      "Left Unsolved": [0, "--scb-gray"]
    }
  );

  const dayCounter = makeCounter(dayElement, 0, 3);
  const hourCounter = makeCounter(hourElement, 0, 2);
  const minuteCounter = makeCounter(minuteElement, 0, 2);
  const secondCounter = makeCounter(secondElement, 0, 2);

  async function start() {
    await saveReady;

    makeDropdownMenu(
      fontDropdown,
      "Font",
      FONT_NAMES,
      FONT_VALUES,
      store.font,
      "scb_font"
    );

    showView(settingsOpen);
    updateStats();
    updateCountdown();
    updateDateLabel();
  }

  function updateCountdown() {
    let diff = Math.max(0, store.date - new Date());
    const days = Math.floor(diff / 86400000);
    diff %= 86400000;
    const hours = Math.floor(diff / 3600000);
    diff %= 3600000;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    dayCounter.set(days);
    hourCounter.set(hours);
    minuteCounter.set(minutes);
    secondCounter.set(seconds);
  }
  function updateDateLabel() {
    testingDayElement.textContent =
      `${store.date.getMonth() + 1}/${store.date.getDate()}/${String(store.date.getFullYear()).slice(-2)} at ` +
      `${store.date.getHours()}:${String(store.date.getMinutes()).padStart(2, "0")} ${store.date.getHours() >= 12 ? "PM" : "AM"}`;
  }

  start();
  window.setInterval(updateCountdown, 1000);
})();
