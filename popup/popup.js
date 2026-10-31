(() => {
  const FONT_VALUES = ["default", "roboto", "arial"];
  const FONT_NAMES = ["Default", "Roboto", "Arial"];
  let font = null;

  const fontDropdown = document.getElementById("font-dropdown");
  const resetButton = document.getElementById("reset-btn");
  const importButton = document.getElementById("import-data");
  const importFile = document.getElementById("import-file");
  let resetTimer = null;
  let resetDataClicks = 0;

  const saveReady = chrome.storage.local.get("scb_font").then((data) => {
    font = data.scb_font || "default";
  });

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

  document.getElementById("qb-btn").addEventListener("click", function () {
    window.open("https://satsuiteeducatorquestionbank.collegeboard.org/digital/search", "_blank");
  });

  document.getElementById("reset-btn").addEventListener("click", function () {
    if (resetDataClicks === 0) {
      resetDataClicks = 1;
      resetButton.textContent = "Are you sure?";
      resetTimer = setTimeout(() => {
        resetDataClicks = 0;
        resetButton.textContent = "Reset Data";
      }, 3000);
      return;
    }

    chrome.storage.local.remove("scb_questions");
    chrome.storage.local.set({ scb_font: "default" });
    fontDropdown.querySelector(".dropdown-toggle").textContent = "Default";
    fontDropdown.dataset.value = "default"
    resetButton.textContent = "Data reset";
    resetDataClicks = 0;
    clearTimeout(resetTimer);
    setTimeout(() => { resetButton.textContent = "Reset Data"; }, 1500);
  });

  document.getElementById("export-data").addEventListener("click", async () => {
    const data = await chrome.storage.local.get(["scb_questions", "scb_font"]);
    const payload = {
      scb_questions: data.scb_questions ?? {},
      scb_font: data.scb_font ?? "default",
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

      const font = FONT_VALUES.includes(parsed.scb_font) ? parsed.scb_font : "default";

      await chrome.storage.local.set({ scb_questions: questions, scb_font: font });

      fontDropdown.dataset.value = font;
      const toggle = fontDropdown.querySelector(".dropdown-toggle");
      if (toggle) toggle.textContent = FONT_NAMES[FONT_VALUES.indexOf(font)];

      importButton.textContent = "Imported";
    } catch (err) {
      importButton.textContent = err;
    }
    setTimeout(() => { importButton.textContent = "Import Data"; }, 1500);
    importFile.value = "";
  });

  async function mainLoop() {
    await saveReady;
    makeDropdownMenu(
      fontDropdown,
      "Font",
      FONT_NAMES,
      FONT_VALUES,
      font,
      "scb_font"
    );
  }

  mainLoop()
})();
