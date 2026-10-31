(() => {
  let font = null;

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
      if (index == optionNames.length) option.classList.add("dropdown-last-item");

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

  async function mainLoop() {
    await saveReady;
    makeDropdownMenu(
      document.getElementById("font-dropdown"),
      "Font",
      ["Default", "Roboto", "Arial"],
      ["default", "roboto", "arial"],
      font,
      "scb_font"
    );
  }

  mainLoop()
})();
