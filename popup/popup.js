(() => {
  const FONT_VALUES = ["default", "roboto", "arial"];
  const FONT_NAMES = ["Default", "Roboto", "Arial"];

  const store = { font: "default", date: new Date() };

  const fontDropdown = document.getElementById("font-dropdown");
  const resetButton = document.getElementById("reset-btn");

  const countdown = document.getElementById("countdown");
  const dayElement = countdown.querySelector(".days");
  const hourElement = countdown.querySelector(".hours");
  const minuteElement = countdown.querySelector(".minutes");
  const secondElement = countdown.querySelector(".seconds");

  const openCalendarButton = document.getElementById("open-calendar")
  const testingDayElement = document.getElementById("testing-day")
  const calendar = document.getElementById("calendar")

  const importButton = document.getElementById("import-data");
  const importFile = document.getElementById("import-file");
  let resetTimer = null;
  let resetDataClicks = 0;

  // saved data

  const saveReady = chrome.storage.local.get(["scb_font", "scb_date"]).then((data) => {
    store.font = data.scb_font || "default";
    store.date = data.scb_date ? new Date(data.scb_date) : new Date();
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

  // question bank button

  document.getElementById("qb-btn").addEventListener("click", function () {
    window.open("https://satsuiteeducatorquestionbank.collegeboard.org/digital/search", "_blank");
  });

  // export, import, reset

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
    store.date = date
    testingDayElement.textContent =
      `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)} at ` +
      `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;

    fontDropdown.querySelector(".dropdown-toggle").textContent = "Default";
    fontDropdown.dataset.value = "default"
    resetButton.textContent = "Data reset";
    resetDataClicks = 0;
    clearTimeout(resetTimer);
    setTimeout(() => { resetButton.textContent = "Reset Data"; }, 1500);
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

      store.font = FONT_VALUES.includes(parsed.scb_font) ? parsed.scb_font : "default";
      const importedDate = Number.isFinite(parsed.scb_date) ? new Date(parsed.scb_date) : null;
      store.date = importedDate ?? store.date;

      updateCountdown();
      updateDateLabel();

      await chrome.storage.local.set({
        scb_questions: questions,
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

  // main loop

  const dayCounter = makeCounter(dayElement, 0, 3)
  const hourCounter = makeCounter(hourElement, 0, 2)
  const minuteCounter = makeCounter(minuteElement, 0, 2)
  const secondCounter = makeCounter(secondElement, 0, 2)

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
