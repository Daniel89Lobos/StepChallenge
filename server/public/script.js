const loginForm = document.getElementById("loginForm");
const logout = document.getElementById("logoutBtn");
const stepsForm = document.getElementById("stepsForm");
const leaderboard = document.getElementById("leaderboard");
const options = document.getElementById("optionBtn");
const backFromOptions = document.getElementById("backBtnOptions");
const registerNewUser = document.getElementById("registerNewUser");
const backFromRegister = document.getElementById("backBtnRegister");
const createNewUser = document.getElementById("createNewUser");
const savePasswordBtn = document.getElementById("saveBtnChangePassword");
const changePasswordInput = document.getElementById("changePassword");
const togglePasswordBtn = document.getElementById("togglePassword");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const backFromChangePassword = document.getElementById("backBtnChangePassword");
const changeGroupInput = document.getElementById("changeGroup");
const backFromChangeGroup = document.getElementById("backBtnChangeGroup");
const saveGroupBtn = document.getElementById("saveBtnChangeGroup");
const toggleLoginPasswordBtn = document.getElementById("toggleLoginPassword");
const toggleRegisterPasswordBtn = document.getElementById(
  "toggleRegisterPassword",
);
const changeStepsOptions = document.getElementById("stepDate");
const saveStepsBtn = document.getElementById("saveBtnChangeSteps");
const changeStepsInput = document.getElementById("changeSteps");

// API Configuration - Change this to your server URL
const API_BASE_URL = "http://localhost:3000/api";

let username = null;
let currentUser = null;

document.getElementById("stepDate").valueAsDate = new Date(); // Shows todays date in the Calendar window
document.getElementById("stepChangeDate").valueAsDate = new Date(); // Shows todays date in the Calendar window

// ----- API Helper Functions -----

async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      credentials: "include", // Include cookies for session management
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "API request failed");
    }

    return data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}

// ----- Change between pages -----

function showOnly(...idsToShow) {
  const allSections = [
    "loginForm",
    "stepsForm",
    "individualLeaderboardSection",
    "groupLeaderboardSection",
    "options",
    "registrationForm",
    "changePasswordOptions",
    "changeGroupOptions",
    "changeStepsOptions",
    "stepLog",
  ];

  allSections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = idsToShow.includes(id) ? "block" : "none";
  });

  // Show or hide the logout button
  const shouldShowLogout =
    idsToShow.includes("stepsForm") ||
    idsToShow.includes("individualLeaderboardSection") ||
    idsToShow.includes("options") ||
    idsToShow.includes("changePasswordOptions") ||
    idsToShow.includes("changeGroupOptions") ||
    idsToShow.includes("changeStepsOptions") ||
    idsToShow.includes("stepLog");

  document.getElementById("logoutBtn").style.display = shouldShowLogout
    ? "block"
    : "none";

  const shouldShowOptions =
    idsToShow.includes("stepsForm") ||
    idsToShow.includes("individualLeaderboardSection") ||
    idsToShow.includes("options") ||
    idsToShow.includes("changePasswordOptions") ||
    idsToShow.includes("changeGroupOptions") ||
    idsToShow.includes("changeStepsOptions") ||
    idsToShow.includes("stepLog");
  document.getElementById("optionBtn").style.display = shouldShowOptions
    ? "block"
    : "none";
}

// ----- Login -----
loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const enteredUsername = usernameInput.value.trim();
  const enteredPassword = passwordInput.value.trim();

  try {
    const response = await apiCall("/login", {
      method: "POST",
      body: JSON.stringify({
        username: enteredUsername,
        password: enteredPassword,
      }),
    });

    // Login successful
    username = response.user.username;
    currentUser = response.user;

    console.log("User logged in:", username);
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();
    showOnly("stepsForm", "individualLeaderboardSection");
  } catch (error) {
    alert(error.message || "Login failed. Please try again.");
    usernameInput.value = "";
    passwordInput.value = "";
  }
});

// Toggle password visibility (Login)
let toggleLoginPasswordListenerAdded = false;

if (!toggleLoginPasswordListenerAdded) {
  toggleLoginPasswordBtn.addEventListener("click", function () {
    const passwordField = document.getElementById("password");
    const isPassword = passwordField.type === "password";
    passwordField.type = isPassword ? "text" : "password";
    toggleLoginPasswordBtn.textContent = isPassword ? "Hide" : "Show";
  });

  toggleLoginPasswordListenerAdded = true;
}

// ----- Register new user page -----
registerNewUser.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("registrationForm");
});

// ----- Create new user -----
createNewUser.addEventListener("click", async function (event) {
  event.preventDefault();

  const newUsernameInput = document.getElementById("newUsername");
  const newPasswordInput = document.getElementById("newPassword");
  const newGroupInput = document.getElementById("group");

  if (!newUsernameInput || !newPasswordInput || !newGroupInput) {
    alert("One or more input fields are missing.");
    return;
  }

  const newUsername = newUsernameInput.value.trim();
  const newPassword = newPasswordInput.value.trim();
  const newGroup = newGroupInput.value.trim();

  if (!newUsername || !newPassword || !newGroup) {
    alert("Please fill in all fields.");
    return;
  }

  try {
    await apiCall("/register", {
      method: "POST",
      body: JSON.stringify({
        username: newUsername,
        password: newPassword,
        group: newGroup,
      }),
    });

    alert("User created successfully! Please log in.");
    showOnly("loginForm");

    // Clear inputs
    newUsernameInput.value = "";
    newPasswordInput.value = "";
    newGroupInput.value = "";
  } catch (error) {
    alert(error.message || "Registration failed. Please try again.");
  }
});

// Toggle password visibility (Register)
let toggleRegisterPasswordListenerAdded = false;

if (!toggleRegisterPasswordListenerAdded) {
  toggleRegisterPasswordBtn.addEventListener("click", function () {
    const passwordField = document.getElementById("newPassword");
    const isPassword = passwordField.type === "password";
    passwordField.type = isPassword ? "text" : "password";
    toggleRegisterPasswordBtn.textContent = isPassword ? "Hide" : "Show";
  });

  toggleRegisterPasswordListenerAdded = true;
}

// ----- Back from Register -----
backFromRegister.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("loginForm");
});

// ----- Logout -----
logout.addEventListener("click", async function (event) {
  event.preventDefault();

  try {
    await apiCall("/logout", { method: "POST" });
    username = null;
    currentUser = null;
    showOnly("loginForm");
  } catch (error) {
    console.error("Logout error:", error);
    // Even if logout fails, clear local state and show login
    username = null;
    currentUser = null;
    showOnly("loginForm");
  }
});

// ----- Options -----
options.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("options");

  // ----- Change password window -----
  changePasswordBtn.addEventListener("click", function (event) {
    event.preventDefault();
    showOnly("changePasswordOptions");

    let togglePasswordListenerAdded = false;

    if (!togglePasswordListenerAdded) {
      togglePasswordBtn.addEventListener("click", function () {
        const isPassword = changePasswordInput.type === "password";
        changePasswordInput.type = isPassword ? "text" : "password";
        togglePasswordBtn.textContent = isPassword ? "Hide" : "Show";
      });

      togglePasswordListenerAdded = true;
    }
  });
});

backFromChangePassword.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("options");
});

// ----- Save new password -----
savePasswordBtn.addEventListener("click", async function (event) {
  event.preventDefault();

  if (changePasswordInput.value.trim() === "") {
    alert("The password cannot be blank!");
    return;
  }

  try {
    await apiCall("/user/password", {
      method: "PUT",
      body: JSON.stringify({
        newPassword: changePasswordInput.value.trim(),
      }),
    });

    alert("Password updated successfully!");
    changePasswordInput.value = "";
    showOnly("options");
  } catch (error) {
    alert(error.message || "Failed to update password");
  }
});

// ----- Change group window -----
changeGroupBtn.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("changeGroupOptions");
});

backFromChangeGroup.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("options");
});

// ----- Save new group -----
saveGroupBtn.addEventListener("click", async function (event) {
  event.preventDefault();

  if (changeGroupInput.value.trim() === "") {
    alert("The group name cannot be blank!");
    return;
  }

  try {
    await apiCall("/user/group", {
      method: "PUT",
      body: JSON.stringify({
        newGroup: changeGroupInput.value.trim(),
      }),
    });

    alert("Group updated successfully!");
    changeGroupInput.value = "";
    showOnly("options");
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();
  } catch (error) {
    alert(error.message || "Failed to update group");
  }
});

// ----- Change steps window -----
changeStepsBtn.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("changeStepsOptions", "stepLog");
  showStepLogDisplay();
});

backBtnChangeSteps.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("options");
});

async function showStepLogDisplay() {
  try {
    const response = await apiCall("/steps");
    const stepLog = response.stepLog || {};
    const displayDiv = document.getElementById("stepLogDisplay");

    if (Object.keys(stepLog).length === 0) {
      displayDiv.innerHTML = "<p>No steps logged yet.</p>";
      return;
    }

    // Sort the dates chronologically
    const sortedDates = Object.keys(stepLog).sort();

    // Build HTML output
    let output = "<ul>";
    for (const date of sortedDates) {
      output += `<li><strong>${date}</strong>: ${stepLog[date]} steps</li>`;
    }
    output += "</ul>";

    displayDiv.innerHTML = output;
  } catch (error) {
    console.error("Error loading step log:", error);
    document.getElementById("stepLogDisplay").innerHTML =
      "<p>Error loading step log.</p>";
  }
}

// ----- Save steps -----
saveStepsBtn.addEventListener("click", async function (event) {
  event.preventDefault();

  const date = document.getElementById("stepChangeDate").value;
  const steps = parseInt(document.getElementById("changeSteps").value);

  if (!date || isNaN(steps)) {
    alert("Please enter both a valid date and number of steps.");
    return;
  }

  try {
    await apiCall("/steps", {
      method: "POST",
      body: JSON.stringify({
        date: date,
        steps: steps,
      }),
    });

    alert(`✅ Updated ${steps} steps for ${date}`);

    // Reset form
    document.getElementById("changeSteps").value = "";
    document.getElementById("stepChangeDate").value = "";

    // Refresh displayed step log and leaderboards
    await showStepLogDisplay();
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();
  } catch (error) {
    alert(error.message || "Failed to save steps");
  }
});

// ----- Back from Options -----
backFromOptions.addEventListener("click", function (event) {
  event.preventDefault();
  showOnly("stepsForm", "individualLeaderboardSection");
});

// ----- Step input -----
stepsForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  if (!username) {
    alert("You're not logged in!");
    return;
  }

  const stepsInput = document.getElementById("steps");
  const steps = parseInt(stepsInput.value);
  const date = document.getElementById("stepDate").value;

  if (!steps || !date) {
    alert("Please enter both steps and a date.");
    return;
  }

  if (isNaN(steps) || steps <= 0) {
    alert("Please enter a valid number of steps.");
    return;
  }

  try {
    await apiCall("/steps", {
      method: "POST",
      body: JSON.stringify({
        date: date,
        steps: steps,
      }),
    });

    // Show confirmation
    document.getElementById("stepFeedback").textContent =
      `✅ You logged ${steps} steps for ${date}`;

    // Update leaderboards
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();

    stepsInput.value = ""; // Clear input
  } catch (error) {
    alert(error.message || "Failed to add steps");
  }
});

// ----- Update individual leaderboard function -----
async function updateIndividualLeaderboard() {
  try {
    const response = await apiCall("/leaderboard/individual");
    const users = response.leaderboard || [];

    const individualLeaderboardBody = document.querySelector(
      "#individualLeaderboard tbody",
    );
    individualLeaderboardBody.innerHTML = "";

    users.forEach((user, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${user.username}</td>
        <td>${user.total_steps}</td>
      `;
      individualLeaderboardBody.appendChild(row);
    });
  } catch (error) {
    console.error("Error updating individual leaderboard:", error);
  }
}

// ----- Update group leaderboard function -----
async function updateGroupLeaderboard() {
  try {
    const response = await apiCall("/leaderboard/group");
    const groups = response.leaderboard || [];

    const groupLeaderboardBody = document.querySelector(
      "#groupLeaderboard tbody",
    );
    groupLeaderboardBody.innerHTML = "";

    groups.forEach((group, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${group.group_name}</td>
        <td>${group.total_steps}</td>
      `;
      groupLeaderboardBody.appendChild(row);
    });
  } catch (error) {
    console.error("Error updating group leaderboard:", error);
  }
}

// ----- Clear individual leaderboard -----
const clearIndividualBtn = document.getElementById("clearIndividualBtn");
clearIndividualBtn.addEventListener("click", async function () {
  if (
    !confirm(
      "Are you sure you want to clear the individual leaderboard? This cannot be undone.",
    )
  ) {
    return;
  }

  try {
    await apiCall("/leaderboard/individual", { method: "DELETE" });
    alert("Individual leaderboard cleared successfully!");
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();
  } catch (error) {
    alert(error.message || "Failed to clear leaderboard");
  }
});

// ----- Clear group leaderboard -----
const clearGroupBtn = document.getElementById("clearGroupBtn");
clearGroupBtn.addEventListener("click", async function () {
  if (
    !confirm(
      "Are you sure you want to clear the group leaderboard? This cannot be undone.",
    )
  ) {
    return;
  }

  try {
    await apiCall("/leaderboard/group", { method: "DELETE" });
    alert("Group leaderboard cleared successfully!");
    await updateIndividualLeaderboard();
    await updateGroupLeaderboard();
  } catch (error) {
    alert(error.message || "Failed to clear leaderboard");
  }
});

// ----- Show group leaderboard -----
const showGroupBtn = document.getElementById("showGroupBtn");

showGroupBtn.addEventListener("click", function (event) {
  event.preventDefault();
  document.getElementById("individualLeaderboardSection").style.display =
    "none";
  document.getElementById("groupLeaderboardSection").style.display = "block";

  updateIndividualLeaderboard();
  updateGroupLeaderboard();
});

// ----- Show individual leaderboard -----
const showIndividualBtnFromGroup = document.getElementById(
  "showIndividualBtnFromGroup",
);

showIndividualBtnFromGroup.addEventListener("click", function (event) {
  event.preventDefault();
  document.getElementById("individualLeaderboardSection").style.display =
    "block";
  document.getElementById("groupLeaderboardSection").style.display = "none";

  updateIndividualLeaderboard();
  updateGroupLeaderboard();
});

// ----- Auto-login check on page load -----
window.addEventListener("load", async function () {
  try {
    const response = await apiCall("/auth/check");

    if (response.authenticated) {
      username = response.username;
      console.log("User already authenticated:", username);

      await updateIndividualLeaderboard();
      await updateGroupLeaderboard();
      showOnly("stepsForm", "individualLeaderboardSection");
    } else {
      showOnly("loginForm");
    }
  } catch (error) {
    console.error("Auth check failed:", error);
    showOnly("loginForm");
  }
});
