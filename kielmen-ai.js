
"use strict";

/* =========================================================
   KIELMEN AI CUSTOMER CHAT
   Shared by the main website and agent stores.
========================================================= */

(() => {
  const API_BASE =
    "https://kielmen-dataplug-payment-api.onrender.com";

  if (document.getElementById("kielmen-ai-widget")) return;

  const styles = document.createElement("style");

  styles.textContent = `
    #kielmen-ai-widget {
      position: fixed;
      right: 18px;
      bottom: 155px;
      z-index: 99999;
      font-family: Arial, sans-serif;
    }

    #kielmen-ai-open {
      width: 60px;
      height: 60px;
      border: 0;
      border-radius: 50%;
      background: #15803d;
      color: white;
      font-size: 25px;
      cursor: pointer;
      box-shadow: 0 5px 20px #0004;
    }

    #kielmen-ai-panel {
      display: none;
      position: absolute;
      right: 0;
      bottom: 72px;
      width: min(360px, calc(100vw - 36px));
      height: 480px;
      max-height: calc(100dvh - 190px);
      border: 1px solid #d1d5db;
      border-radius: 18px;
      overflow: hidden;
      background: white;
      color: #111827;
      box-shadow: 0 8px 35px #0003;
      flex-direction: column;
    }

    #kielmen-ai-panel.open {
      display: flex;
    }

    #kielmen-ai-header {
      padding: 16px;
      background: #15803d;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #kielmen-ai-header strong {
      font-size: 16px;
    }

    #kielmen-ai-close {
      border: 0;
      background: transparent;
      color: white;
      font-size: 24px;
      cursor: pointer;
    }

    #kielmen-ai-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #f9fafb;
    }

    .kielmen-ai-message {
      width: fit-content;
      max-width: 88%;
      padding: 11px 13px;
      margin: 9px 0;
      border-radius: 13px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .kielmen-ai-bot {
      background: #e5e7eb;
      color: #111827;
      border-bottom-left-radius: 3px;
    }

    .kielmen-ai-user {
      margin-left: auto;
      background: #15803d;
      color: white;
      border-bottom-right-radius: 3px;
    }

    #kielmen-ai-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      background: white;
    }

    #kielmen-ai-question {
      flex: 1;
      min-width: 0;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      outline: none;
      font-size: 14px;
    }

    #kielmen-ai-send {
      padding: 0 15px;
      border: 0;
      border-radius: 10px;
      background: #15803d;
      color: white;
      font-weight: bold;
      cursor: pointer;
    }

    #kielmen-ai-send:disabled {
      opacity: .6;
      cursor: not-allowed;
    }

    #kielmen-ai-note {
      padding: 0 12px 9px;
      color: #6b7280;
      background: white;
      font-size: 11px;
      text-align: center;
    }

    @media (min-width: 950px) {
      #kielmen-ai-widget {
        bottom: 25px;
      }
    }
  `;

  document.head.appendChild(styles);

  const widget = document.createElement("div");
  widget.id = "kielmen-ai-widget";

  widget.innerHTML = `
    <section id="kielmen-ai-panel" aria-label="Kielmen Assistant">
      <header id="kielmen-ai-header">
        <strong>💬 Kielmen Assistant</strong>
        <button id="kielmen-ai-close" type="button"
          aria-label="Close chat">×</button>
      </header>

      <div id="kielmen-ai-messages" aria-live="polite">
      </div>

      <form id="kielmen-ai-form">
        <input
          id="kielmen-ai-question"
          type="text"
          maxlength="500"
          placeholder="Type your question..."
          autocomplete="off"
          required
        >
        <button id="kielmen-ai-send" type="submit">
          Send
        </button>
      </form>

      <div id="kielmen-ai-note">
        Kielmen customer assistance
      </div>
    </section>

    <button id="kielmen-ai-open" type="button"
      aria-label="Open Kielmen Assistant">
      💬
    </button>
  `;

  document.body.appendChild(widget);

  const panel = document.getElementById("kielmen-ai-panel");
  const openButton = document.getElementById("kielmen-ai-open");
  const closeButton = document.getElementById("kielmen-ai-close");
  const messages = document.getElementById("kielmen-ai-messages");
  const form = document.getElementById("kielmen-ai-form");
  const input = document.getElementById("kielmen-ai-question");
  const sendButton = document.getElementById("kielmen-ai-send");

  function addMessage(message, sender) {
    const bubble = document.createElement("div");

    bubble.className =
      "kielmen-ai-message " +
      (sender === "user"
        ? "kielmen-ai-user"
        : "kielmen-ai-bot");

    bubble.textContent = message;

    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;

    return bubble;
  }

  openButton.addEventListener("click", () => {
    panel.classList.add("open");
    openButton.style.display = "none";
    input.focus();

    if (!messages.dataset.greeted) {
      addMessage(
        "Hello! 👋 Welcome to Kielmen 636 Dataplug. How can I help you today?",
        "bot"
      );

      messages.dataset.greeted = "true";
    }
  });

  closeButton.addEventListener("click", () => {
    panel.classList.remove("open");
    openButton.style.display = "block";
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const question = input.value.trim();

    if (!question || sendButton.disabled) return;

    addMessage(question, "user");

    input.value = "";
    sendButton.disabled = true;
    sendButton.textContent = "...";

    const waiting = addMessage(
      "One moment please, let me check that for you...",
      "bot"
    );

    try {
      const response = await fetch(
        API_BASE + "/ai/answer",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ question })
        }
      );

      const data = await response.json();

      waiting.remove();

      if (!response.ok || !data.success) {
        throw new Error("Request failed");
      }

      addMessage(
        data.answer ||
        "Sorry, I couldn't find an answer. Please contact our support team.",
        "bot"
      );

    } catch (error) {
      waiting.remove();

      addMessage(
        "Sorry, I'm having trouble connecting right now. Please try again shortly or contact Kielmen Support on WhatsApp.",
        "bot"
      );

      console.error("Kielmen AI chat:", error);

    } finally {
      sendButton.disabled = false;
      sendButton.textContent = "Send";
      input.focus();
    }
  });
})();
