const accountNotice = document.getElementById("accountNotice");
const guestAccountPanels = document.getElementById("guestAccountPanels");
const accountProfilePanel = document.getElementById("accountProfilePanel");
const accountProfileHeading = document.getElementById("accountProfileHeading");
const accountProfileUsername = document.getElementById("accountProfileUsername");
const accountLoginForm = document.getElementById("accountLoginForm");
const accountRegisterForm = document.getElementById("accountRegisterForm");
const accountLoginButton = document.getElementById("accountLoginButton");
const accountRegisterButton = document.getElementById("accountRegisterButton");
const accountLogoutButton = document.getElementById("accountLogoutButton");

function showAccountNotice(message, type = "error") {
  if (!accountNotice) {
    return;
  }

  accountNotice.hidden = false;
  accountNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  accountNotice.textContent = message;
}

function clearAccountNotice() {
  if (!accountNotice) {
    return;
  }

  accountNotice.hidden = true;
  accountNotice.className = "page-status";
  accountNotice.textContent = "";
}

async function fetchProfile() {
  const response = await fetch("/api/user/profile", {
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(data.error || "Could not load your account");
  }

  return data.user || null;
}

function renderGuestPanels() {
  guestAccountPanels.hidden = false;
  accountProfilePanel.hidden = true;
  accountLoginForm?.reset();
  accountRegisterForm?.reset();
}

function renderProfilePanel(user) {
  if (!user) {
    renderGuestPanels();
    return;
  }

  guestAccountPanels.hidden = true;
  accountProfilePanel.hidden = false;
  accountProfileHeading.textContent = `Welcome, ${user.username}`;
  accountProfileUsername.textContent = user.username || "-";
}

function setAccountLoading(button, isLoading, idleText, busyText) {
  if (!button) {
    return;
  }

  button.disabled = isLoading;
  button.textContent = isLoading ? busyText : idleText;
}

async function refreshAccountPage() {
  if (!guestAccountPanels || !accountProfilePanel) {
    return;
  }

  await window.LobosAuth.refresh();
  const sessionUser = window.LobosAuth.getUser();

  if (!sessionUser) {
    renderGuestPanels();
    return;
  }

  try {
    const profile = await fetchProfile();
    renderProfilePanel(profile || sessionUser);
  } catch (error) {
    showAccountNotice(error.message);
  }
}

if (guestAccountPanels && accountProfilePanel) {
  refreshAccountPage();

  accountLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAccountNotice();

    const formData = new FormData(accountLoginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      showAccountNotice("Enter both your username and password.");
      return;
    }

    try {
      setAccountLoading(accountLoginButton, true, "Log in", "Logging in...");
      await window.LobosAuth.login(username, password);
      await refreshAccountPage();
      showAccountNotice("You are now logged in.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not log in.");
    } finally {
      setAccountLoading(accountLoginButton, false, "Log in", "Logging in...");
    }
  });

  accountRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAccountNotice();

    const formData = new FormData(accountRegisterForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      showAccountNotice("Choose a username and password to create your account.");
      return;
    }

    try {
      setAccountLoading(accountRegisterButton, true, "Create account", "Creating account...");
      await window.LobosAuth.registerAndLogin({ username, password });
      await refreshAccountPage();
      showAccountNotice("Your account is ready and you are now logged in.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not create your account.");
    } finally {
      setAccountLoading(accountRegisterButton, false, "Create account", "Creating account...");
    }
  });

  accountLogoutButton?.addEventListener("click", async () => {
    clearAccountNotice();

    try {
      setAccountLoading(accountLogoutButton, true, "Log out", "Logging out...");
      await window.LobosAuth.logout();
      await refreshAccountPage();
      showAccountNotice("You are now logged out.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not log out.");
    } finally {
      setAccountLoading(accountLogoutButton, false, "Log out", "Logging out...");
    }
  });
}
