var BentoboxCore = function(exports) {
  "use strict";
  class ConsentRecordError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = "ConsentRecordError";
      this.code = code;
      this.status = status;
    }
  }
  const SESSION_TIMER_MS = 30 * 60 * 1e3;
  const AUDIO_UPLOAD_DRAIN_TIMEOUT_MS = 3e3;
  class WidgetController {
    constructor(stateMachine, apiClient, ui, opts) {
      this.stateMachine = stateMachine;
      this.apiClient = apiClient;
      this.ui = ui;
      this.opts = opts;
      this.m1Timer = null;
      this.activeChat = null;
      this.abortController = null;
      this.host = null;
      this.completing = false;
      this.openingText = null;
      this.startFailed = false;
      this.pendingAudioUpload = null;
    }
    /**
     * boot — dwell → intercept → consent → consent-record → /v1/sessions → SESSION_ACTIVE
     *
     * The full widget lifecycle starting sequence.
     */
    async boot(host) {
      var _a, _b, _c;
      this.host = host;
      this.abortController = new AbortController();
      const interceptResult = await new Promise((resolve) => {
        this.ui.mountIntercept(
          host,
          () => {
            resolve("shown");
          },
          () => {
            resolve("dismissed");
          }
        );
      });
      if (interceptResult === "dismissed") {
        await this.stateMachine.dismissIntercept();
        return;
      }
      await this.stateMachine.clickIntercept();
      const consentResult = await this.ui.mountConsent(host, {
        displayName: (_a = this.opts.displayName) != null ? _a : this.opts.clientId,
        termsUrl: `${this.opts.apiBase}/terms`
      });
      if (!consentResult.accepted) {
        return;
      }
      await this.handleConsentAccepted(
        {
          consentVersion: consentResult.consentVersion,
          consentAcceptedAt: consentResult.consentAcceptedAt
        },
        () => {
          this.activeChat = this.ui.mountChat(host);
          this.activeChat.setThinking(true);
          this.startM1Timer();
        }
      );
      if (this.stateMachine.state !== "SESSION_ACTIVE") return;
      if (this.startFailed) {
        (_b = this.activeChat) == null ? void 0 : _b.destroy();
        this.activeChat = null;
        return;
      }
      if (this.activeChat) {
        if (this.openingText) {
          this.activeChat.appendTurn({ role: "agent", text: this.openingText });
        } else {
          this.activeChat.setThinking(false);
        }
      } else {
        this.activeChat = this.ui.mountChat(host, (_c = this.openingText) != null ? _c : void 0);
        this.startM1Timer();
      }
    }
    /**
     * handleConsentAccepted — POST /widget/consent-record → POST /v1/sessions
     *
     * CTO spec: on 400/401 from consent-record, widget MUST NOT transition to
     * SESSION_ACTIVE and MUST NOT call MediaRecorder.start(). Error stays in CONSENT state.
     */
    async handleConsentAccepted(consent, onActivated) {
      var _a;
      const consentRecordId = await this.postConsentRecord(consent);
      if (!consentRecordId) {
        throw new ConsentRecordError(
          "consent-record response missing consentRecordId",
          "MISSING_CONSENT_RECORD_ID",
          200
        );
      }
      await this.stateMachine.acceptConsent();
      onActivated == null ? void 0 : onActivated();
      const sessionToken = (_a = this.stateMachine.getSessionToken()) != null ? _a : "";
      try {
        const result = await this.apiClient.startInterview({
          sessionToken,
          token: sessionToken,
          ...this.opts.spotlight ? { spotlight: this.opts.spotlight } : {}
        });
        this.openingText = result.agentReply;
      } catch (e) {
        this.startFailed = true;
      }
    }
    /**
     * sendMessage — route through stateMachine + apiClient
     */
    async sendMessage(text) {
      await this.stateMachine.sendMessage({ text });
    }
    /**
     * handleMessageReceived — called by the widget element when MESSAGE_RECEIVED fires.
     * Updates the active chat panel with the agent reply and signals completion.
     */
    handleMessageReceived(payload) {
      var _a;
      if (!this.activeChat) return;
      this.activeChat.appendTurn({ role: "agent", text: payload.agentReply });
      if ((_a = payload.progress) == null ? void 0 : _a.phase) {
        this.activeChat.setProgressPhase(payload.progress.phase);
      }
      if (payload.isComplete) {
        this.activeChat.setDone(true);
      }
    }
    /**
     * handleSendFailed — recoverable send failures (the state machine reports them as
     * saga:error EVENTS and stays SESSION_ACTIVE, so nothing throws into the chat UI's
     * own catch). The element routes SEND_FAILED / NETWORK_ERROR / RATE_LIMITED here;
     * the chat panel clears thinking, restores the participant's text, and shows the
     * notice — instead of freezing forever (live 529 incident, 2026-06-11). The server
     * never recorded the failed turn, so resending continues the conversation exactly.
     */
    handleSendFailed(code) {
      if (!this.activeChat) return;
      const notice = code === "RATE_LIMITED" ? "You’re sending quickly — give it a few seconds, then tap send again." : "That didn’t go through — your answer is back in the box. Give it a moment and tap send again.";
      this.activeChat.failSend(notice);
    }
    /**
     * handleFinish — flag #7: await Promise.race([pendingAudioUpload, 3s]) before
     * calling completeSession. Ensures in-flight audio upload drains cleanly.
     */
    async handleFinish() {
      var _a;
      if (this.pendingAudioUpload !== null) {
        const drainTimeout = new Promise(
          (resolve) => setTimeout(resolve, AUDIO_UPLOAD_DRAIN_TIMEOUT_MS)
        );
        await Promise.race([this.pendingAudioUpload, drainTimeout]);
      }
      this.clearM1Timer();
      if (this.completing) {
        await this.stateMachine.completeSession();
        return;
      }
      this.completing = true;
      try {
        await this.stateMachine.completeSession();
      } catch (e) {
      }
      const token = (_a = this.stateMachine.getSessionToken()) != null ? _a : "";
      try {
        const result = await this.apiClient.completeSession({ sessionToken: token });
        if (result.outcome) {
          const rewardCtx = {
            outcome: result.outcome
          };
          if (result.incentiveCode !== void 0) {
            rewardCtx.incentiveCode = result.incentiveCode;
          }
          this.ui.mountReward(this.host, rewardCtx);
        }
      } catch (e) {
      }
    }
    /**
     * handleSpaNavigation — flag #10 / M3: synchronous tear-down.
     *
     * Must be synchronous: called from pagehide/popstate handlers.
     * - Stops DOM, listeners, MediaRecorder (no upload)
     * - Aborts any in-flight fetch calls
     * - Clears timers
     * - Does NOT await anything
     */
    handleSpaNavigation() {
      var _a, _b;
      this.clearM1Timer();
      (_a = this.abortController) == null ? void 0 : _a.abort();
      this.abortController = null;
      (_b = this.activeChat) == null ? void 0 : _b.destroy();
      this.activeChat = null;
      this.pendingAudioUpload = null;
      this.ui.destroy();
      void this.stateMachine.handleSpaNavigation();
    }
    /**
     * destroy — full cleanup (same as SPA navigation but async-safe)
     */
    destroy() {
      var _a, _b;
      this.clearM1Timer();
      (_a = this.abortController) == null ? void 0 : _a.abort();
      this.abortController = null;
      (_b = this.activeChat) == null ? void 0 : _b.destroy();
      this.activeChat = null;
      this.pendingAudioUpload = null;
      this.ui.destroy();
    }
    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------
    /**
     * startM1Timer — 30min session max (M1 constant).
     * On fire: emit bento:session-closed reason:expired and transition state.
     */
    startM1Timer() {
      this.clearM1Timer();
      this.m1Timer = setTimeout(() => {
        this.m1Timer = null;
        void this.stateMachine.receiveApiResponse({ status: 410 });
      }, SESSION_TIMER_MS);
    }
    clearM1Timer() {
      if (this.m1Timer !== null) {
        clearTimeout(this.m1Timer);
        this.m1Timer = null;
      }
    }
    /**
     * postConsentRecord — POST /widget/consent-record per CTO spec.
     *
     * Throws ConsentRecordError on 400/401/403.
     * Returns consentRecordId on 200.
     */
    async postConsentRecord(consent) {
      var _a, _b, _c;
      const body = JSON.stringify({
        consentVersion: consent.consentVersion,
        consentAcceptedAt: consent.consentAcceptedAt,
        clientId: this.opts.clientId,
        tenantId: this.opts.tenantId,
        // The session is created at mount, before this consent step — pass its token so the server
        // links the consent record to this chat (and /start can require it). The server stamps its
        // own version + time; the two fields above are kept for back-compat/logging only.
        sessionToken: (_a = this.stateMachine.getSessionToken()) != null ? _a : ""
      });
      let res;
      try {
        res = await fetch(`${this.opts.apiBase}/widget/consent-record`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.opts.interceptToken}`
          },
          body,
          signal: (_c = (_b = this.abortController) == null ? void 0 : _b.signal) != null ? _c : null
        });
      } catch (err) {
        throw new ConsentRecordError(`Network error: ${String(err)}`, "NETWORK_ERROR", 0);
      }
      if (res.status === 200) {
        const json = await res.json();
        return json.consentRecordId;
      }
      let code = "UNKNOWN";
      try {
        const errBody = await res.json();
        if (typeof errBody.code === "string") {
          code = errBody.code;
        }
      } catch (e) {
      }
      throw new ConsentRecordError(
        `consent-record failed: ${code}`,
        code,
        res.status
      );
    }
  }
  const SessionApiErrorCode = {
    UNAUTHORIZED: "UNAUTHORIZED",
    ORIGIN_BLOCKED: "ORIGIN_BLOCKED",
    TOKEN_REVOKED: "TOKEN_REVOKED",
    SESSION_EXPIRED: "SESSION_EXPIRED",
    RATE_LIMITED: "RATE_LIMITED",
    NETWORK_ERROR: "NETWORK_ERROR",
    REFRESH_TIMEOUT: "REFRESH_TIMEOUT",
    ENV_MISMATCH: "ENV_MISMATCH"
  };
  class SessionApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = "SessionApiError";
      this.code = code;
      this.status = status;
    }
  }
  const MAX_429_RETRIES = 3;
  const REFRESH_TIMEOUT_MS = 5e3;
  const RETRY_BACKOFF_BASE_MS = 100;
  function resolve403Code(bodyCode) {
    if (bodyCode === "ORIGIN_NOT_ALLOWLISTED") return SessionApiErrorCode.ORIGIN_BLOCKED;
    if (bodyCode === "TOKEN_REVOKED") return SessionApiErrorCode.TOKEN_REVOKED;
    if (bodyCode === "ENV_MISMATCH") return SessionApiErrorCode.ENV_MISMATCH;
    return SessionApiErrorCode.TOKEN_REVOKED;
  }
  async function fetchWithRetry(url, init, retriesLeft = MAX_429_RETRIES) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new SessionApiError(
        `Network error: ${String(err)}`,
        SessionApiErrorCode.NETWORK_ERROR,
        0
      );
    }
    if (res.status === 429 && retriesLeft > 0) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1e3 : RETRY_BACKOFF_BASE_MS * (MAX_429_RETRIES - retriesLeft + 1);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return fetchWithRetry(url, init, retriesLeft - 1);
    }
    return res;
  }
  async function parseResponse(res) {
    if (res.status === 401) {
      throw new SessionApiError("Unauthorized", SessionApiErrorCode.UNAUTHORIZED, 401);
    }
    if (res.status === 403) {
      let bodyCode;
      try {
        const body = await res.clone().json();
        bodyCode = typeof body.code === "string" ? body.code : void 0;
      } catch (e) {
      }
      const code = resolve403Code(bodyCode);
      throw new SessionApiError(`Forbidden: ${bodyCode != null ? bodyCode : "unknown"}`, code, 403);
    }
    if (res.status === 410) {
      throw new SessionApiError("Session expired", SessionApiErrorCode.SESSION_EXPIRED, 410);
    }
    if (res.status === 429) {
      throw new SessionApiError("Rate limited", SessionApiErrorCode.RATE_LIMITED, 429);
    }
    if (res.status >= 500) {
      throw new SessionApiError(
        `Server error: ${res.status.toString()}`,
        SessionApiErrorCode.NETWORK_ERROR,
        res.status
      );
    }
    return res.json();
  }
  class SessionApiClient {
    constructor(options) {
      this.revocationInFlight = false;
      this.refreshPromise = null;
      this.blockedQueue = [];
      this.baseUrl = options.baseUrl;
    }
    /**
     * POST /v1/sessions — create a new session with a client token.
     * Includes 429 retry logic. No silent refresh on 429.
     *
     * The session is created at MOUNT, before consent — so no consent data rides this request. The
     * consent record is created separately (POST /widget/consent-record) and enforced at /start.
     */
    async startSession(params) {
      const body = { client_id: params.token };
      const res = await fetchWithRetry(`${this.baseUrl}/v1/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.token}`
        },
        body: JSON.stringify(body)
      });
      return parseResponse(res);
    }
    /**
     * POST /v1/sessions/:sessionToken/start — start the moderator for an existing
     * session and return its opening line. Split out of create so the Opus moderator
     * is only ever spun up AFTER consent (and exactly once — the server guards it).
     */
    async startInterview(params) {
      const res = await fetchWithRetry(`${this.baseUrl}/v1/sessions/${params.sessionToken}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.token}`
        },
        body: JSON.stringify(params.spotlight ? { spotlight: params.spotlight } : {})
      });
      return parseResponse(res);
    }
    /**
     * POST /v1/sessions/refresh — silent refresh of a session token.
     *
     * Silent refresh contract (staff-engineer spec):
     * - Only ONE refresh in flight at a time (revocationInFlight flag).
     * - Concurrent callers share the same in-flight promise.
     * - 5-second timeout → REFRESH_TIMEOUT error.
     */
    async refreshSessionToken(params) {
      if (this.revocationInFlight && this.refreshPromise !== null) {
        return this.refreshPromise;
      }
      this.revocationInFlight = true;
      this.refreshPromise = this._doRefresh(params.sessionToken);
      try {
        const result = await this.refreshPromise;
        return result;
      } finally {
        this.revocationInFlight = false;
        this.refreshPromise = null;
        const queued = this.blockedQueue.splice(0);
        queued.forEach((cb) => {
          cb();
        });
      }
    }
    _doRefresh(sessionToken) {
      const fetchPromise = fetch(`${this.baseUrl}/v1/sessions/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ session_token: sessionToken })
      }).then((res) => parseResponse(res)).catch((err) => {
        if (err instanceof SessionApiError) throw err;
        throw new SessionApiError(
          `Network error: ${String(err)}`,
          SessionApiErrorCode.NETWORK_ERROR,
          0
        );
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new SessionApiError("Refresh timeout (5s)", SessionApiErrorCode.REFRESH_TIMEOUT, 0));
        }, REFRESH_TIMEOUT_MS);
      });
      return Promise.race([fetchPromise, timeoutPromise]);
    }
    /**
     * POST /v1/sessions/:id/messages — send a message in an active session.
     * If a refresh is in flight, waits until it completes before proceeding.
     */
    async sendMessage(params) {
      if (this.revocationInFlight) {
        await new Promise((resolve) => {
          this.blockedQueue.push(resolve);
        });
      }
      const res = await fetchWithRetry(
        `${this.baseUrl}/v1/sessions/${params.sessionToken}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.sessionToken}`
          },
          body: JSON.stringify({ content: params.text })
        }
      );
      return parseResponse(res);
    }
    /**
     * POST /v1/sessions/:id/complete — mark a session as complete.
     * TODO(NEEDS_CHANGES #1): Sprint 4 — differentiated "Session ended" copy when revoked mid-completing.
     */
    async completeSession(params) {
      const res = await fetchWithRetry(
        `${this.baseUrl}/v1/sessions/${params.sessionToken}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.sessionToken}`
          },
          body: JSON.stringify({})
        }
      );
      return parseResponse(res);
    }
  }
  const PA_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#37352f"/><text x="24" y="32" font-family="Georgia, serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">P</text></svg>'
  );
  function createResponse(token) {
    return {
      sessionToken: token,
      expiresIn: 1800,
      // Mirrors the live API's exact incentive shape so the intercept/consent advertise the reward —
      // the demo simulates the whole thing (Jesse 2026-06-12).
      incentive_config: {
        type: "gift_card",
        amount: 25,
        currency: "USD",
        displayLabel: "$25 Gift Card"
      },
      audio_enabled: true,
      // show the mic so the demo feels complete
      branding_tier: "paid",
      // Server-authoritative branding, like a real paid tenant: the P logo + Productivity App ink.
      branding_config: {
        logo_url: PA_LOGO,
        font_family: null,
        accent_color: "#37352f"
      }
    };
  }
  const SCRIPTS = {
    // Retention: a Productivity App user on the AI agents (the flagship sandbox script — matches
    // the agents spotlight in the demo corpus: set-it-up → where it broke → reliance verdict).
    "productivity-agents": {
      createResponse: createResponse("st_demo_pa_agents"),
      opening: "Thanks for taking a few minutes with us. I'd love to hear about Productivity App's AI agents, the AI helpers you can ask in plain language to read your pages and pull together work for you. How has your experience with them been overall?",
      turns: [
        {
          agentReply: "That gives me a good picture. Walk me through the last time you set one up or asked one to do something. What was it for?",
          phase: "WARMING_UP"
        },
        {
          agentReply: "Tell me more about how that went. Did it do what you expected, or was there a moment it surprised you?",
          phase: "EXPLORING"
        },
        {
          agentReply: "Good to know. How often does something like that come up in a normal week for you?",
          phase: "EXPLORING"
        },
        {
          agentReply: "That detail helps. When something like that happens, what do you do next? Do you go back and fix it, or set it aside?",
          phase: "PROBING"
        },
        {
          agentReply: "Really clear, thank you. Let me step back for a second: if the agents disappeared tomorrow, what would change about how you work?",
          phase: "PROBING"
        },
        {
          agentReply: "That tells me a lot. Is there anything else you'd like to share about your experience before we wrap up?",
          phase: "WRAPPING_UP"
        },
        {
          agentReply: "That's everything I needed, thanks for taking the time. You'll see your $25 gift card as soon as we wrap up.",
          phase: "WRAPPING_UP",
          isComplete: true
        }
      ],
      complete: { incentiveCode: "PA-GIFT-7X4K", outcome: "reward" }
    },
    // Acquisition: a first-time visitor on the Productivity App homepage (the agents-pitch page).
    // Opens INTENT-first per the acquisition opener (what brought them, before experience).
    "productivity-homepage": {
      createResponse: createResponse("st_demo_pa_home"),
      opening: "Thanks for taking a few minutes with us. I'd love to hear about the Productivity App homepage, the page with the AI agents pitch up top. What brought you to take a look today?",
      turns: [
        {
          agentReply: "That makes sense. As you scrolled through the page, what stood out to you, for better or worse?",
          phase: "WARMING_UP"
        },
        {
          agentReply: "Good to know. Was there anything you wanted answered that the page left fuzzy, like what the agents actually do, or what they cost?",
          phase: "EXPLORING"
        },
        {
          agentReply: "Helpful, thank you. Walk me through what was going through your mind as you weighed whether this was for you.",
          phase: "EXPLORING"
        },
        {
          agentReply: "Given what you saw, where did you land on trying it? Would you sign up, or hold off for now?",
          phase: "PROBING"
        },
        {
          agentReply: "That tells me a lot. What would have made that decision easier, either way?",
          phase: "PROBING"
        },
        {
          agentReply: "Thank you. Is there anything else you'd like to share about your experience before we wrap up?",
          phase: "WRAPPING_UP"
        },
        {
          agentReply: "That's everything I needed, thanks for taking the time. You'll see your $25 gift card as soon as we wrap up.",
          phase: "WRAPPING_UP",
          isComplete: true
        }
      ],
      complete: { incentiveCode: "PA-GIFT-7X4K", outcome: "reward" }
    }
  };
  function getDemoScript(id) {
    var _a;
    return (_a = SCRIPTS[id]) != null ? _a : null;
  }
  function createScriptedFetch(opts) {
    const { script, apiBase, realFetch } = opts;
    let turn = 0;
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const scripted = (input, init) => {
      var _a, _b;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(apiBase)) return realFetch(input, init);
      const path = ((_a = url.slice(apiBase.length).split("?")[0]) != null ? _a : "").replace(/\/$/, "");
      if (path === "/v1/sessions") return Promise.resolve(json(script.createResponse));
      if (path === "/v1/sessions/refresh") {
        return Promise.resolve(
          json({
            sessionToken: script.createResponse.sessionToken,
            expiresIn: script.createResponse.expiresIn
          })
        );
      }
      if (path.endsWith("/start")) {
        return Promise.resolve(json({ agentReply: script.opening, isComplete: false }));
      }
      if (path.endsWith("/messages")) {
        const idx = Math.min(turn, script.turns.length - 1);
        const t = script.turns[idx];
        turn = Math.min(turn + 1, script.turns.length);
        return Promise.resolve(
          json({
            agentReply: t.agentReply,
            isComplete: (_b = t.isComplete) != null ? _b : false,
            turnIndex: idx + 1,
            progress: { questionsAsked: idx + 1, phase: t.phase }
          })
        );
      }
      if (path.endsWith("/complete")) return Promise.resolve(json(script.complete));
      if (path === "/widget/consent-record") {
        return Promise.resolve(json({ consentRecordId: "cr_demo" }));
      }
      return realFetch(input, init);
    };
    return scripted;
  }
  function installScriptedDemo(scriptId, apiBase) {
    const script = getDemoScript(scriptId);
    if (!script) {
      console.warn(
        `[saga-widget] unknown data-demo-script "${scriptId}" — booting against the real API`
      );
      return null;
    }
    const realFetch = globalThis.fetch.bind(globalThis);
    const scripted = createScriptedFetch({ script, apiBase, realFetch });
    globalThis.fetch = scripted;
    return () => {
      if (globalThis.fetch === scripted) globalThis.fetch = realFetch;
    };
  }
  const CONSENT_VERSION = "v1.0-draft";
  function interceptCopy(input) {
    const { brandName, rubric } = input;
    return rubric === "acquisition" ? {
      headline: "Got a couple of minutes?",
      // Pre-signup: they're evaluating, not necessarily first-time — keep it open.
      sub: `We'd love your honest impression of ${brandName}.`
    } : {
      headline: "Got a couple of minutes?",
      sub: `We'd love to hear how ${brandName} is going for you.`
    };
  }
  function consentCopy(input) {
    const { brandName, rubric, incentive } = input;
    const sub = rubric === "retention" ? `Let's have a quick conversation about your experience with ${brandName}.` : `Let's have a quick conversation about what brought you to ${brandName} today.`;
    const bullets = [
      "You'll be chatting with an AI assistant. It's quick and casual.",
      "There are no right answers. We just want your honest take.",
      "Type or talk, whatever's easier for you."
    ];
    if (incentive.enabled) {
      bullets.push(`When you're done, we'll send you ${incentive.label} as a thank-you.`);
    }
    return {
      headline: `Help us make ${brandName} better.`,
      sub,
      bullets,
      cta: "Start the conversation",
      agreeNote: "You'll need to be 18 or older. By starting, you agree to our Research Participant Terms."
    };
  }
  function renderIntercept(host, opts) {
    var _a, _b, _c, _d, _e;
    const rubric = (_a = opts.rubric) != null ? _a : "retention";
    const incentive = (_b = opts.incentive) != null ? _b : { enabled: false, label: "" };
    const copy = interceptCopy({ brandName: opts.brandName, rubric });
    const incentiveBlock = incentive.enabled && incentive.label.trim().length > 0 ? `
        <div class="incentive">
          <span class="gift">${GIFT_SVG}</span>
          <span>
            <span class="big">${escape$1(incentive.label)}</span>
            <span class="sml">our thank-you when you finish</span>
          </span>
        </div>` : "";
    host.innerHTML = `
    <div class="intercept" role="dialog" aria-label="${escape$1(opts.brandName)} feedback invite">
      <div class="top">
        <span class="w-logo-wrap">
          ${opts.logoUrl ? `<img class="brand-logo" src="${escape$1(opts.logoUrl)}" alt="${escape$1(opts.brandName)}" />` : `<span class="brand-wordmark">${escape$1(opts.brandName)}</span>`}
        </span>
        <span class="w-controls">
          <button class="w-ctl min" type="button" aria-label="Minimize">${MIN_SVG$1}</button>
          <button class="w-ctl x" type="button" aria-label="Dismiss">${X_SVG}</button>
        </span>
      </div>
      <div class="i-body">
        <h3>${escape$1(copy.headline)}</h3>
        <p class="i-sub">${escape$1(copy.sub)}</p>
        ${incentiveBlock}
      </div>
      <div class="i-foot">
        <button class="w-cta" type="button" data-role="start">Start →</button>
        <button class="i-maybe" type="button" data-role="dismiss">Not right now</button>
      </div>
      <div class="powered">powered by <b>sagainsights.ai</b></div>
    </div>
  `;
    (_c = host.querySelector('[data-role="start"]')) == null ? void 0 : _c.addEventListener("click", opts.onAccept);
    (_d = host.querySelector('[data-role="dismiss"]')) == null ? void 0 : _d.addEventListener("click", opts.onDismiss);
    (_e = host.querySelector(".x")) == null ? void 0 : _e.addEventListener("click", opts.onDismiss);
  }
  const X_SVG = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const MIN_SVG$1 = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const GIFT_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
  function escape$1(s) {
    return s.replace(/[&<>"']/g, (c) => {
      var _a;
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return (_a = map[c]) != null ? _a : c;
    });
  }
  function validateTermsUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return url;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  function isSupported() {
    const w = window;
    return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
  }
  async function ensureMicPermission() {
    const devices = navigator.mediaDevices;
    if (!(devices == null ? void 0 : devices.getUserMedia)) return;
    const gum = devices.getUserMedia.bind(devices);
    const stream = await gum({ audio: true });
    stream.getTracks().forEach((t) => {
      t.stop();
    });
  }
  function mapMediaError(err) {
    if (err instanceof Error) {
      switch (err.name) {
        case "NotAllowedError":
        case "SecurityError":
          return "not-allowed";
        case "NotFoundError":
        case "DevicesNotFoundError":
          return "audio-capture";
        case "NotReadableError":
        case "TrackStartError":
          return "audio-capture";
        default:
          return err.name || "aborted";
      }
    }
    return "aborted";
  }
  function createDictation(cb, locale = "en") {
    var _a;
    const w = window;
    const Ctor = (_a = w.SpeechRecognition) != null ? _a : w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = locale.replace("_", "-");
    let listening = false;
    rec.onstart = () => {
      listening = true;
      cb.onStart();
    };
    rec.onend = () => {
      listening = false;
      cb.onEnd();
    };
    rec.onerror = (e) => {
      listening = false;
      cb.onError(e.error);
    };
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0].transcript;
        if (r.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      if (interim) cb.onInterim(interim);
      if (final) cb.onFinal(final);
    };
    return {
      start: () => {
        if (listening) return;
        void (async () => {
          try {
            await ensureMicPermission();
          } catch (err) {
            cb.onError(mapMediaError(err));
            return;
          }
          try {
            rec.start();
          } catch (err) {
            cb.onError(err.name || "aborted");
          }
        })();
      },
      stop: () => {
        if (!listening) return;
        rec.stop();
      },
      isListening: () => listening
    };
  }
  function appendTranscript(base, addition) {
    if (!base) return addition.trim();
    const sep = /\s$/.test(base) ? "" : " ";
    return base + sep + addition.trim();
  }
  function micErrorMessage(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "microphone access denied — check browser and OS mic permissions, then try again";
      case "no-speech":
        return "didn't catch that — try again";
      case "audio-capture":
        return "no microphone detected, or it's in use by another app";
      case "network":
        return "mic needs internet to transcribe — check your connection";
      case "aborted":
      case "AbortError":
        return "";
      default:
        return `mic error (${code})`;
    }
  }
  const CODEC_CASCADE = ["audio/webm;codecs=opus", "audio/mp4"];
  function isAudioCaptureSupported() {
    if (typeof window === "undefined") return false;
    if (typeof window.MediaRecorder === "undefined") return false;
    return CODEC_CASCADE.some((mime) => window.MediaRecorder.isTypeSupported(mime));
  }
  function pickMimeType() {
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return null;
    for (const mime of CODEC_CASCADE) {
      if (window.MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return null;
  }
  async function startAudioCapture() {
    if (!isAudioCaptureSupported()) return null;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return null;
    }
    const mimeType = pickMimeType();
    if (!mimeType) {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      return null;
    }
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      return null;
    }
    const chunks = [];
    let startedAt = 0;
    let stopped = false;
    const releaseStream = () => {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
    };
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.start(1e3);
    startedAt = performance.now();
    return {
      async stop() {
        if (stopped) {
          releaseStream();
          return null;
        }
        stopped = true;
        await new Promise((resolve) => {
          recorder.onstop = () => {
            resolve();
          };
          const t = setTimeout(() => {
            resolve();
          }, 1e3);
          try {
            recorder.stop();
          } catch (e) {
            clearTimeout(t);
            resolve();
          }
        });
        releaseStream();
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        if (chunks.length === 0) return null;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size === 0) return null;
        return { blob, durationMs, mimeType };
      },
      cancel() {
        if (stopped) {
          releaseStream();
          return;
        }
        stopped = true;
        try {
          recorder.stop();
        } catch (e) {
        }
        releaseStream();
      }
    };
  }
  async function uploadAndCommitAudio(input) {
    const { api, sessionId, turnIndex, payload, onError } = input;
    let handle;
    try {
      handle = await api.audioUploadUrl(sessionId, turnIndex, payload.mimeType);
    } catch (err) {
      onError("sign", err);
      return false;
    }
    if (payload.blob.size > handle.maxBytes) {
      onError("upload", new Error(`blob exceeds maxBytes (${String(payload.blob.size)})`));
      return false;
    }
    try {
      const r = await fetch(handle.url, {
        method: handle.method,
        headers: handle.headers,
        body: payload.blob
      });
      if (!r.ok) {
        onError("upload", new Error(`upload failed ${String(r.status)}`));
        return false;
      }
    } catch (err) {
      onError("upload", err);
      return false;
    }
    try {
      await api.audioCommit(sessionId, turnIndex, payload.durationMs);
      return true;
    } catch (err) {
      onError("commit", err);
      return false;
    }
  }
  const TOTAL_DOTS = 4;
  function renderConsent(opts) {
    var _a, _b, _c, _d;
    const { host, brandName, termsUrl, onAccepted, onClose } = opts;
    const rubric = (_a = opts.rubric) != null ? _a : "retention";
    const incentive = (_b = opts.incentive) != null ? _b : { enabled: false, label: "" };
    const copy = consentCopy({ brandName, rubric, incentive });
    const safeTermsUrl = (_c = validateTermsUrl(termsUrl)) != null ? _c : "#";
    host.innerHTML = `
    <div class="panel-consent" role="dialog" aria-label="Before you start">
      <div class="brand-bar">
        <span class="w-logo-wrap">
          ${opts.logoUrl ? `<img class="brand-logo" src="${escape(opts.logoUrl)}" alt="${escape(brandName)}" />` : `<span class="brand-wordmark">${escape(brandName)}</span>`}
        </span>
        <span class="w-controls">
          <button class="w-ctl min" type="button" aria-label="Minimize">${MIN_SVG}</button>
          <button class="w-ctl x" type="button" aria-label="Close">${SMALL_X_SVG}</button>
        </span>
      </div>

      <div class="c-offer">
        <h2>${escape(copy.headline)}</h2>
        <p class="c-sub">${escape(copy.sub)}</p>
      </div>

      <ul class="c-bullets">
        ${copy.bullets.map((b) => `<li>${escape(b)}</li>`).join("")}
      </ul>

      <div class="c-foot">
        <button class="w-cta" type="button" data-role="start">${escape(copy.cta)} →</button>
        <p class="c-agree">${escape(copy.agreeNote).replace("Research Participant Terms", `<a href="${escape(safeTermsUrl)}" target="_blank" rel="noopener">Research Participant Terms ↗</a>`)}</p>
      </div>
    </div>
  `;
    (_d = host.querySelector(".brand-bar .x")) == null ? void 0 : _d.addEventListener("click", onClose);
    const startBtn = host.querySelector('[data-role="start"]');
    startBtn == null ? void 0 : startBtn.addEventListener("click", () => {
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      const consentAcceptedAt = (/* @__PURE__ */ new Date()).toISOString();
      void onAccepted({ consentVersion: CONSENT_VERSION, consentAcceptedAt });
    });
  }
  function mountChat(host, opts) {
    var _a, _b, _c, _d, _e;
    const { brandName, locale = "en", onSend, onFinish, onClose } = opts;
    const hasVoice = isSupported();
    const voicePlaceholder = hasVoice ? "Tap mic to talk · or type" : "Type your answer…";
    const micButton = hasVoice ? `<button class="sq rec idle-pulse" data-role="mic" type="button" aria-label="Start voice input" aria-pressed="false" title="Speaking is faster. Your browser transcribes; audio stays on your device.">${MIC_SVG}</button>` : "";
    host.innerHTML = `
    <div class="panel-chat" role="dialog" aria-label="${escape(brandName)} feedback interview">
      <div class="chat-head">
        <span class="w-logo-wrap">
          ${opts.logoUrl ? `<img class="brand-logo" src="${escape(opts.logoUrl)}" alt="${escape(brandName)}" />` : `<span class="who">${escape(brandName)}</span>`}
        </span>
        <span class="w-controls">
          <button class="w-ctl min" type="button" aria-label="Minimize">${MIN_SVG}</button>
          <button class="w-ctl x" type="button" aria-label="Close">${SMALL_X_SVG}</button>
        </span>
      </div>
      <div class="chat-body" aria-live="polite"></div>
      <div class="composer">
        <div class="progress-row">
          <span class="step-label">Step 1 of ${String(TOTAL_DOTS)}</span>
          <div class="progress" aria-label="Interview progress">
            ${Array.from({ length: TOTAL_DOTS }).map(() => `<div></div>`).join("")}
          </div>
        </div>
        <div class="row${hasVoice ? "" : " composer-grid no-mic"}">
          <textarea placeholder="${escape(voicePlaceholder)}" rows="1"></textarea>
          <button class="sq send" type="button" data-role="send" disabled aria-label="Send">${SEND_SVG}</button>
          ${micButton}
        </div>
        <div class="hint">${hasVoice ? "Tap mic to speak" : "answers stay private"}</div>
      </div>
    </div>
  `;
    const closeBtn = host.querySelector(".x");
    const body = (_a = host.querySelector(".chat-body")) != null ? _a : document.createElement("div");
    const composerEl = (_b = host.querySelector(".composer")) != null ? _b : document.createElement("div");
    const textarea = (_c = host.querySelector("textarea")) != null ? _c : document.createElement("textarea");
    const sendBtn = (_d = host.querySelector('[data-role="send"]')) != null ? _d : document.createElement("button");
    const micBtn = host.querySelector('[data-role="mic"]');
    const dots = host.querySelectorAll(".progress div");
    const stepLabel = host.querySelector(".step-label");
    closeBtn == null ? void 0 : closeBtn.addEventListener("click", onClose);
    const viewState = {
      messages: [],
      thinking: false,
      done: false,
      finishing: false,
      // Starts at 1: the moderator opens in WARMING_UP (phase 1). Server phase
      // (setProgressPhase) advances it; it never moves on local turn count.
      progressDots: 1
    };
    function refresh() {
      var _a2;
      body.innerHTML = "";
      for (const m of viewState.messages) {
        const wrap = document.createElement("div");
        if (m.role === "moderator") {
          wrap.className = "msg bot";
          wrap.innerHTML = `<div class="bubble"></div>`;
          const botBubble = wrap.querySelector(".bubble");
          if (botBubble) botBubble.textContent = m.text;
        } else if (m.role === "shopper") {
          wrap.className = "msg user";
          wrap.innerHTML = `<div class="bubble"></div>`;
          const userBubble = wrap.querySelector(".bubble");
          if (userBubble) userBubble.textContent = m.text;
        } else {
          wrap.className = "msg system";
          wrap.innerHTML = `<div class="bubble"></div>`;
          const sysBubble = wrap.querySelector(".bubble");
          if (sysBubble) sysBubble.textContent = m.text;
        }
        body.appendChild(wrap);
      }
      if (viewState.thinking) {
        const typing = document.createElement("div");
        typing.className = "typing";
        typing.innerHTML = `<div class="dots"><span></span><span></span><span></span></div>`;
        body.appendChild(typing);
      }
      if (viewState.done && !viewState.finishing) {
        const finishRow = document.createElement("div");
        finishRow.className = "finish-row";
        finishRow.innerHTML = `
        <button class="finish-btn" type="button" data-role="finish">
          Finish interview →
        </button>
      `;
        body.appendChild(finishRow);
        (_a2 = finishRow.querySelector('[data-role="finish"]')) == null ? void 0 : _a2.addEventListener("click", () => {
          if (viewState.finishing) return;
          viewState.finishing = true;
          refresh();
          void onFinish();
        });
      }
      if (viewState.finishing) {
        const pending = document.createElement("div");
        pending.className = "finish-row pending";
        pending.textContent = "Loading your gift card…";
        body.appendChild(pending);
      }
      body.scrollTop = body.scrollHeight;
      composerEl.style.display = viewState.done ? "none" : "";
      dots.forEach((d, i) => {
        if (i < viewState.progressDots) d.classList.add("on");
        else d.classList.remove("on");
      });
      if (stepLabel) {
        const step = Math.min(Math.max(viewState.progressDots, 1), TOTAL_DOTS);
        stepLabel.textContent = `Step ${String(step)} of ${String(TOTAL_DOTS)}`;
      }
    }
    function adjustSendButton() {
      sendBtn.disabled = viewState.thinking || viewState.done || textarea.value.trim().length === 0;
    }
    const MAX_TEXTAREA_H = 140;
    function autoGrow() {
      textarea.style.height = "auto";
      const next = textarea.scrollHeight;
      if (next > MAX_TEXTAREA_H) {
        textarea.style.height = `${String(MAX_TEXTAREA_H)}px`;
        textarea.style.overflowY = "auto";
      } else {
        textarea.style.height = `${String(next)}px`;
        textarea.style.overflowY = "hidden";
      }
    }
    let dictation = null;
    let committedText = "";
    let acceptingDictation = false;
    let activeAudioCapture = null;
    let lastSentText = "";
    const audioCaptureEnabled = isAudioCaptureSupported();
    const hintEl = host.querySelector(".composer .hint");
    const defaultHint = (_e = hintEl == null ? void 0 : hintEl.textContent) != null ? _e : "";
    let hintResetTimer = null;
    function showMicMessage(text, resetMs = 5e3) {
      if (!hintEl) return;
      if (hintResetTimer) clearTimeout(hintResetTimer);
      hintEl.textContent = text;
      hintEl.classList.add("mic-error");
      hintResetTimer = setTimeout(() => {
        hintEl.textContent = defaultHint;
        hintEl.classList.remove("mic-error");
        hintResetTimer = null;
      }, resetMs);
    }
    function stopIdlePulse() {
      micBtn == null ? void 0 : micBtn.classList.remove("idle-pulse");
    }
    function stopDictation() {
      if (!dictation) return;
      acceptingDictation = false;
      if (dictation.isListening()) dictation.stop();
      if (activeAudioCapture) {
        activeAudioCapture.cancel();
        activeAudioCapture = null;
      }
    }
    if (micBtn) {
      dictation = createDictation(
        {
          onStart: () => {
            acceptingDictation = true;
            committedText = textarea.value;
            micBtn.classList.add("listening");
            micBtn.setAttribute("aria-pressed", "true");
            stopIdlePulse();
            if (audioCaptureEnabled && !activeAudioCapture) {
              void startAudioCapture().then((s) => {
                if (s && acceptingDictation) {
                  activeAudioCapture = s;
                } else if (s) {
                  s.cancel();
                }
              });
            }
          },
          onEnd: () => {
            acceptingDictation = false;
            micBtn.classList.remove("listening");
            micBtn.setAttribute("aria-pressed", "false");
            adjustSendButton();
          },
          onInterim: (text) => {
            if (!acceptingDictation) return;
            textarea.value = appendTranscript(committedText, text);
            autoGrow();
            adjustSendButton();
          },
          onFinal: (text) => {
            if (!acceptingDictation) return;
            committedText = appendTranscript(committedText, text);
            textarea.value = committedText;
            autoGrow();
            adjustSendButton();
          },
          onError: (error) => {
            acceptingDictation = false;
            micBtn.classList.remove("listening");
            micBtn.setAttribute("aria-pressed", "false");
            adjustSendButton();
            showMicMessage(micErrorMessage(error));
          }
        },
        locale
      );
      micBtn.addEventListener("click", () => {
        if (!dictation) return;
        if (dictation.isListening()) stopDictation();
        else dictation.start();
      });
    }
    textarea.addEventListener("input", () => {
      stopIdlePulse();
      committedText = textarea.value;
      autoGrow();
      adjustSendButton();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendCurrent();
      }
    });
    sendBtn.addEventListener("click", () => void sendCurrent());
    async function sendCurrent() {
      const text = textarea.value.trim();
      if (!text || viewState.thinking || viewState.done) return;
      const capturedAudio = activeAudioCapture;
      activeAudioCapture = null;
      stopDictation();
      lastSentText = text;
      textarea.value = "";
      committedText = "";
      textarea.style.height = "auto";
      viewState.messages.push({ role: "shopper", text });
      viewState.thinking = true;
      refresh();
      adjustSendButton();
      if (capturedAudio) {
        void capturedAudio.stop();
      }
      try {
        await onSend(text);
      } catch (err) {
        viewState.thinking = false;
        viewState.messages.push({
          role: "system",
          text: `Sorry — something went wrong. ${err.message}`
        });
        refresh();
        adjustSendButton();
      }
    }
    let destroyed = false;
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopDictation();
      if (hintResetTimer) clearTimeout(hintResetTimer);
      host.innerHTML = "";
    }
    refresh();
    return {
      appendTurn(turn) {
        if (destroyed) return;
        if (turn.role === "user") ;
        else {
          viewState.thinking = false;
          viewState.messages.push({ role: "moderator", text: turn.text });
          refresh();
          adjustSendButton();
        }
      },
      setThinking(thinking) {
        if (destroyed) return;
        viewState.thinking = thinking;
        refresh();
        adjustSendButton();
      },
      failSend(notice) {
        if (destroyed || viewState.done) return;
        viewState.thinking = false;
        const last = viewState.messages[viewState.messages.length - 1];
        if (last && last.role === "shopper" && last.text === lastSentText) {
          viewState.messages.pop();
        }
        if (lastSentText) {
          textarea.value = lastSentText;
          committedText = lastSentText;
        }
        viewState.messages.push({ role: "system", text: notice });
        refresh();
        autoGrow();
        adjustSendButton();
      },
      setProgressPhase(phase) {
        if (destroyed) return;
        const clamped = Math.min(Math.max(phase, 1), TOTAL_DOTS);
        if (clamped > viewState.progressDots) {
          viewState.progressDots = clamped;
          refresh();
        }
      },
      setDone(done, outcome) {
        if (destroyed) return;
        viewState.done = done;
        if (done) {
          viewState.progressDots = TOTAL_DOTS;
        }
        refresh();
        adjustSendButton();
      },
      destroy
    };
  }
  function renderReward(host, ctx) {
    var _a, _b, _c, _d;
    const { incentiveCode, outcome, brandName, onClose } = ctx;
    if (outcome === "rejected") {
      host.innerHTML = `
      <div class="panel-reward" role="dialog" aria-label="Interview ended">
        <div class="check-area">
          <h1>Thanks for your <em>time.</em></h1>
          <p class="sub">We weren't able to offer a reward this round.</p>
        </div>
        <div class="cta-row">
          <button class="done" type="button" data-role="close">Close</button>
        </div>
      </div>
    `;
      (_a = host.querySelector('[data-role="close"]')) == null ? void 0 : _a.addEventListener("click", onClose);
      return;
    }
    if (outcome === "no-reward" || !incentiveCode) {
      host.innerHTML = `
      <div class="panel-reward" role="dialog" aria-label="Thanks">
        <div class="check-area">
          <div class="check-big">${BIG_CHECK_SVG}</div>
          <h1>All <em>set.</em><br>That was helpful.</h1>
          <p class="sub">The team at ${escape(brandName)} will read every word.</p>
        </div>
        <div class="cta-row">
          <button class="done" type="button" data-role="close">Close</button>
        </div>
      </div>
    `;
      (_b = host.querySelector('[data-role="close"]')) == null ? void 0 : _b.addEventListener("click", onClose);
      return;
    }
    host.innerHTML = `
    <div class="panel-reward" role="dialog" aria-label="Your reward">
      <div class="check-area">
        <div class="check-big">${BIG_CHECK_SVG}</div>
        <h1>All <em>set.</em><br>That was helpful.</h1>
        <p class="sub">The team at ${escape(brandName)} will read every word.</p>
      </div>

      <div class="gc">
        <div class="tag">your reward</div>
        <div class="amt">${escape(incentiveCode)}</div>
        <div class="code">
          <span data-role="code-text">${escape(incentiveCode)}</span>
          <button type="button" data-role="copy">copy</button>
        </div>
        <div class="email-note">
          ${EMAIL_SVG}
          copy the code now to redeem your reward
        </div>
      </div>

      <div class="cta-row">
        <button class="shop" type="button" data-role="shop">Back to ${escape(brandName)} →</button>
        <button class="done" type="button" data-role="close">I'm done, thanks</button>
      </div>

    </div>
  `;
    (_c = host.querySelector('[data-role="close"]')) == null ? void 0 : _c.addEventListener("click", onClose);
    (_d = host.querySelector('[data-role="shop"]')) == null ? void 0 : _d.addEventListener("click", onClose);
    const copyBtn = host.querySelector('[data-role="copy"]');
    const code = incentiveCode;
    async function copyCode() {
      try {
        const clipboard = navigator.clipboard;
        if (clipboard == null ? void 0 : clipboard.writeText) {
          await clipboard.writeText(code);
          return true;
        }
      } catch (e) {
      }
      return false;
    }
    function flashCopied() {
      if (!copyBtn) return;
      const original = copyBtn.textContent;
      copyBtn.textContent = "copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        if (copyBtn.textContent === "copied!") {
          copyBtn.textContent = original;
          copyBtn.classList.remove("copied");
        }
      }, 1800);
    }
    void (async () => {
      const ok = await copyCode();
      if (ok) flashCopied();
    })();
    copyBtn == null ? void 0 : copyBtn.addEventListener("click", () => {
      void copyCode().then((ok) => {
        if (ok) flashCopied();
      });
    });
  }
  function renderSessionExpired(host, onStartOver, onClose) {
    var _a, _b;
    host.innerHTML = `
    <div class="panel-err" role="dialog" aria-label="Session expired"
         data-testid="bento-session-expired-message">
      <h3>Session expired</h3>
      <p>Your session has ended. Start a new one to continue.</p>
      <button type="button" data-role="start-over"
              data-testid="bento-start-over-cta">Start over</button>
      <button type="button" data-role="close">Close</button>
    </div>
  `;
    (_a = host.querySelector('[data-role="start-over"]')) == null ? void 0 : _a.addEventListener("click", onStartOver);
    (_b = host.querySelector('[data-role="close"]')) == null ? void 0 : _b.addEventListener("click", onClose);
  }
  function escape(s) {
    return s.replace(/[&<>"']/g, (c) => {
      var _a;
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return (_a = map[c]) != null ? _a : c;
    });
  }
  const SMALL_X_SVG = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const MIN_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const SEND_SVG = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 10.5l2.5 2.5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const MIC_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="6" y="2" width="4" height="8" rx="2" fill="currentColor"/><path d="M3 8a5 5 0 0010 0M8 13v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const BIG_CHECK_SVG = `<svg width="26" height="26" viewBox="0 0 32 32" fill="none"><path d="M7 17l5 5L25 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const EMAIL_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" opacity="0.7"><rect x="1.5" y="3" width="13" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 8h10M3 4.5h10M3 11.5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  function wrapSendWithAudioUpload(opts) {
    let turnIndex = 0;
    return async function wrappedOnSend(text) {
      const thisTurnIndex = turnIndex++;
      const audioCapture = await startAudioCapture();
      if (audioCapture) {
        const uploadPromise = (async () => {
          var _a;
          const payload = await audioCapture.stop();
          if (!payload) return;
          await uploadAndCommitAudio({
            api: opts.audioApi,
            sessionId: (_a = opts.getSessionToken()) != null ? _a : "",
            turnIndex: thisTurnIndex,
            payload,
            onError: (stage, err) => {
              console.warn(`[saga-audio] upload error at stage "${stage}":`, err);
            }
          });
        })();
        opts.onPendingAudioUpload(uploadPromise);
      }
      if (opts.onSend) {
        await opts.onSend(text);
      }
    };
  }
  function createSessionBridge(_opts) {
    let currentChat = null;
    let destroyed = false;
    return {
      mountIntercept(host, onShown, onDismissed) {
        if (destroyed) return;
      },
      async mountConsent(host, ctx) {
        if (destroyed) {
          return { accepted: false, consentVersion: "", consentAcceptedAt: "" };
        }
        return new Promise(
          () => {
          }
        );
      },
      mountChat(host) {
        if (destroyed) {
          return {
            appendTurn(_turn) {
            },
            setThinking(_thinking) {
            },
            setProgressPhase(_phase) {
            },
            setDone(_done) {
            },
            failSend(_notice) {
            },
            destroy() {
            }
          };
        }
        return {
          appendTurn(_turn) {
          },
          setThinking(_thinking) {
          },
          setProgressPhase(_phase) {
          },
          setDone(_done) {
          },
          failSend(_notice) {
          },
          destroy() {
          }
        };
      },
      mountReward(host, ctx) {
        if (destroyed) return;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        currentChat == null ? void 0 : currentChat.destroy();
        currentChat = null;
      }
    };
  }
  const WIDGET_FONTS_HREF = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,700;0,8..60,900;1,8..60,700;1,8..60,900&family=JetBrains+Mono:wght@400;500&display=swap";
  const WIDGET_STYLES = `
:host {
  all: initial;

  --coral-50:  #FEF2F2;
  --coral-100: #FEE2E2;
  --coral-200: #FECACA;
  --coral-300: #FCA5A5;
  --coral-400: #F87171;
  --coral-500: #D92626;
  --coral-600: #B91C1C;
  --seaweed-50:  #F1F5F0;
  --seaweed-100: #DCE6D9;
  --seaweed-200: #B6C9B0;
  --seaweed-300: #82A179;
  --seaweed-400: #577F4E;
  --seaweed-500: #3D6334;
  --seaweed-600: #2F4E28;
  --seaweed-700: #243B1F;
  --tamago-50:  #FFF9E8;
  --tamago-100: #FFEFB8;
  --tamago-200: #FFE082;
  --tamago-300: #F5C842;
  --tamago-400: #E0AE1F;
  --soy-400: #9A7F56;
  --soy-500: #6E5838;
  --rice-50:  #FAFBFC;
  --rice-100: #F5F6F8;
  --rice-150: #ECEEF1;
  --rice-200: #E1E4EA;
  --rice-300: #C2C7D1;
  --rice-400: #8E97A4;
  --rice-500: #5A6271;
  --rice-600: #3D4351;
  --rice-700: #2A2E39;
  --rice-800: #1A1D24;
  --rice-900: #0F1216;

  --bg-surface: #FFFFFF;
  --bg-page: var(--rice-50);
  --border-subtle: var(--rice-150);
  --border-default: var(--rice-200);
  --text-primary: var(--rice-800);
  --text-secondary: var(--rice-600);
  --text-tertiary: var(--rice-400);
  --ink: #1A1D24;

  --r-sm: 6px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-full: 999px;

  --shadow-lg: 0 20px 60px rgba(0,0,0,0.25);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.12);

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-base: 200ms;
  --dur-slow: 320ms;

  --font-sans: "DM Sans", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-display: "Source Serif 4", Georgia, "Times New Roman", serif;
  --font-mono: "JetBrains Mono", ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  /* Banner design vars — alias the tenant's branding (set via applyBranding on the host
     element; CSS custom properties pierce the shadow boundary so the alias works).
     --b-on-accent / --b-logo-filter are always white for any client accent. */
  --b-accent: var(--bento-color-primary, var(--coral-500, #1f2228));
  --b-on-accent: #ffffff;
  /* Optional per-tenant accents — these DEFAULT to the original neutral widget look, so the shared
     widget is unchanged for every client. A specific tenant (e.g. the Keeper demo) overrides any of
     them with an inline style on the <saga-widget> host; CSS custom properties cascade through the
     shadow boundary, so no shared code carries one client's palette. */
  --gift-accent: #f7f7f5; /* incentive-card background */
  --gift-border: #ebeae6; /* incentive-card border */
  --present-accent: var(--b-accent); /* gift icon fill — the brand accent by default */
  --present-ink: var(--b-on-accent); /* gift icon glyph */
  --cta-bg: #1f2228; /* Start button */
  --cta-bg-hover: #32363e;
  --reward-ink: #ffffff; /* reward-card text */
  --reward-accent: #ffffff; /* reward-card tag / amount */
  --b-logo-filter: brightness(0) invert(1);
  --b-display: var(--bento-font-family, var(--font-display, system-ui, -apple-system, sans-serif));
  --b-display-weight: 600;

  font-family: var(--font-sans);
  color: var(--text-primary);
  line-height: 1.5;
}

* { box-sizing: border-box; }

@media (prefers-reduced-motion: reduce) {
  .intercept, .panel-consent, .panel-chat, .panel-reward,
  .confetti, .msg, .sq.rec { animation: none !important; }
}

.root { color: var(--text-primary); }
.root.bottom-right {
  position: fixed;
  right: 22px; bottom: 22px;
  z-index: 2147483640;
}
.root.overlay {
  position: fixed; inset: 0;
  z-index: 2147483640;
  background: rgba(26, 29, 36, 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: grid; place-items: center;
  padding: 20px;
}

/* ============================================================
   INTERCEPT (p01) — Banner skin
   ============================================================ */
.intercept {
  width: 360px;
  max-width: calc(100vw - 24px);
  background: white;
  border-radius: 14px;
  box-shadow: 0 22px 56px rgba(20,22,26,0.2), 0 3px 10px rgba(20,22,26,0.07);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow: hidden;
  animation: intercept-rise var(--dur-slow) var(--ease-out);
}
@keyframes intercept-rise {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* ── Shared banner header (intercept, consent, chat) ───────── */
.brand-logo { height: 20px; width: auto; max-width: 140px; object-fit: contain; display: block; }
.w-logo-wrap { display: inline-flex; align-items: center; min-width: 0; margin-right: auto; }
.brand-wordmark {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 16px; letter-spacing: 0.01em; color: inherit;
}
.w-controls { display: flex; gap: 6px; }
.w-ctl {
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  border: none; cursor: pointer; color: inherit;
  background: color-mix(in srgb, currentColor 14%, transparent);
  transition: background 0.15s;
}
.w-ctl:hover { background: color-mix(in srgb, currentColor 26%, transparent); }

/* ── Shared dark CTA ────────────────────────────────────────── */
.w-cta {
  width: 100%; padding: 13px 16px;
  font-size: 14px; font-weight: 600; font-family: inherit;
  background: var(--cta-bg); color: #fff;
  border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
}
.w-cta:hover { background: var(--cta-bg-hover); }
.w-cta:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Intercept: banner header ────────────────────────────────── */
.intercept .top {
  background: var(--b-accent);
  color: var(--b-on-accent);
  padding: 15px 16px;
  display: flex; align-items: center; gap: 10px;
}
.intercept .top .brand-logo { filter: var(--b-logo-filter); }

/* ── Intercept: body ─────────────────────────────────────────── */
.intercept .i-body { padding: 18px 22px 4px; }
.intercept h3 {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 24px; line-height: 1.15; letter-spacing: -0.01em;
  margin: 0 0 8px; color: #23252b; text-wrap: balance;
}
.intercept .i-sub { font-size: 13.5px; color: #5c6068; margin: 0; max-width: 34ch; }

/* ── Intercept: incentive card ──────────────────────────────── */
.intercept .incentive {
  display: flex; align-items: center; gap: 12px;
  margin-top: 16px; padding: 13px 15px;
  background: var(--gift-accent); border: 1px solid var(--gift-border); border-radius: 10px;
}
.intercept .incentive .gift {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  background: var(--present-accent); color: var(--present-ink);
  display: grid; place-items: center;
}
.intercept .incentive .big {
  display: block;
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 18px; line-height: 1.15;
  color: color-mix(in oklab, var(--b-accent) 55%, #1f2228);
}
.intercept .incentive .sml { display: block; font-size: 11.5px; opacity: 0.75; margin-top: 2px; }

/* ── Intercept: footer ──────────────────────────────────────── */
.intercept .i-foot { padding: 16px 22px 6px; display: flex; flex-direction: column; gap: 4px; }
.intercept .i-maybe {
  background: none; border: none; padding: 7px; width: 100%;
  font-size: 12px; color: #8a8f98; cursor: pointer; font-family: inherit;
}
.intercept .i-maybe:hover { color: #5c6068; }
.intercept .powered {
  padding: 9px 22px 12px; font-size: 10.5px; letter-spacing: 0.04em;
  text-align: center; color: #9aa0a8;
}
.intercept .powered b { font-weight: 600; color: #6f747d; }

/* ============================================================
   CONSENT (p02) — Banner skin
   ============================================================ */
.panel-consent {
  width: 480px; max-width: 100%;
  max-height: calc(100vh - 56px);
  background: white; border-radius: 14px;
  box-shadow: 0 22px 56px rgba(20,22,26,0.2), 0 3px 10px rgba(20,22,26,0.07);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: modal-rise var(--dur-slow) var(--ease-out);
}
@keyframes modal-rise { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* Banner header */
.panel-consent .brand-bar {
  background: var(--b-accent); color: var(--b-on-accent);
  padding: 15px 16px;
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.panel-consent .brand-bar .brand-logo { filter: var(--b-logo-filter); }
.panel-consent .brand-bar .brand-wordmark { color: var(--b-on-accent); }

/* Offer section */
.panel-consent .c-offer {
  padding: 18px 26px; border-bottom: 1px solid #f0efec; flex-shrink: 0;
}
.panel-consent .c-offer h2 {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 25px; line-height: 1.2; letter-spacing: -0.01em;
  text-wrap: balance; margin: 0 0 8px; color: #23252b;
}
.panel-consent .c-sub { font-size: 13.5px; color: #5c6068; margin: 0; line-height: 1.55; }

/* Bullet list */
.panel-consent .c-bullets {
  list-style: none; margin: 0; padding: 16px 26px; flex: 1; overflow-y: auto;
}
.panel-consent .c-bullets li {
  position: relative;
  padding: 6px 0 6px 20px;
  font-size: 13.5px; line-height: 1.55; color: #23252b;
}
.panel-consent .c-bullets li::before {
  content: ""; position: absolute; left: 4px; top: 15px;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--b-accent);
}

/* Footer */
.panel-consent .c-foot { padding: 16px 26px 18px; flex-shrink: 0; }
.panel-consent .c-agree {
  font-size: 11.5px; color: #8a8f98; text-align: center;
  margin: 12px 0 0; line-height: 1.5;
}
.panel-consent .c-agree a { color: #5c6068; }

/* ============================================================
   CHAT (p03) — Banner skin
   ============================================================ */
.panel-chat {
  width: 480px; height: min(640px, calc(100vh - 40px));
  max-width: 100%;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 22px 56px rgba(20,22,26,0.2), 0 3px 10px rgba(20,22,26,0.07);
  border: 1px solid rgba(255, 255, 255, 0.85);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: modal-rise var(--dur-slow) var(--ease-out);
}

/* Banner header */
.panel-chat .chat-head {
  padding: 15px 16px;
  display: flex; align-items: center; gap: 10px;
  background: var(--b-accent); color: var(--b-on-accent);
  flex-shrink: 0;
}
.panel-chat .chat-head .brand-logo { filter: var(--b-logo-filter); }
.panel-chat .chat-head .who {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 16px; color: var(--b-on-accent);
  margin-right: auto;
}

/* Minimise pill (shared, shown when chat is collapsed) */
.min-bubble[hidden] { display: none; }
.min-bubble {
  display: inline-flex; align-items: center; gap: 12px;
  height: 48px; padding: 0 8px 0 20px;
  border-radius: var(--r-full);
  background: var(--bg-surface); color: var(--text-primary);
  border: 1px solid var(--border-default); cursor: pointer;
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  animation: intercept-rise var(--dur-base) var(--ease-out);
}
.min-bubble:hover { box-shadow: var(--shadow-lg); transform: translateY(-1px); }
.min-bubble .bubble-label { font-size: 14px; font-weight: 600; white-space: nowrap; letter-spacing: -0.01em; }
.min-bubble .bubble-caret {
  display: grid; place-items: center;
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--ink); color: white; flex-shrink: 0;
}

/* Debug banner */
.panel-chat .mode-debug {
  font-family: var(--font-mono); font-size: 10.5px;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--coral-700, #b32020); background: var(--coral-50, #fdebe9);
  padding: 4px 16px; border-bottom: 1px solid var(--rice-150, #ece7df);
}

/* Message area */
.panel-chat .chat-body {
  flex: 1; padding: 18px 18px 6px;
  display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto; background: #fafaf8;
}
.msg { display: flex; max-width: 86%; animation: rise .35s ease-out both; }
.msg.user { margin-left: auto; justify-content: flex-end; }
@keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.msg .bubble {
  padding: 10px 14px; border-radius: 13px;
  font-size: 13.5px; line-height: 1.5;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; min-width: 0;
}
.msg.bot .bubble { background: #f1f1ee; color: #23252b; border-bottom-left-radius: 4px; }
.msg.user .bubble { background: var(--b-accent); color: var(--b-on-accent); border-bottom-right-radius: 4px; }
.msg.system .bubble { background: var(--tamago-100); color: var(--rice-800); border: 1px solid var(--tamago-200); font-size: 13px; border-radius: 10px; }

/* Typing indicator */
.typing { display: flex; }
.typing .dots {
  background: #f1f1ee; padding: 12px 16px;
  border-radius: 13px; border-bottom-left-radius: 4px;
  display: flex; gap: 4px;
}
.typing .dots span { width: 6px; height: 6px; border-radius: 50%; background: #8a8f98; animation: blink 1.3s infinite; }
.typing .dots span:nth-child(2) { animation-delay: .2s; }
.typing .dots span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }

/* Composer */
.panel-chat .composer { padding: 12px 16px 14px; background: #fff; border-top: 1px solid #ecebe7; flex-shrink: 0; }
.panel-chat .composer .progress-row { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
.panel-chat .composer .step-label { font-size: 10.5px; letter-spacing: 0.05em; color: #8a8f98; white-space: nowrap; }
.panel-chat .progress { display: flex; gap: 3px; }
.panel-chat .progress div { height: 3px; border-radius: 99px; background: #e4e4e1; width: 26px; flex: 0 0 26px; }
.panel-chat .progress div.on { background: var(--b-accent); }
.panel-chat .composer .row { display: grid; grid-template-columns: 1fr 38px 38px; gap: 8px; align-items: end; }
.panel-chat .composer .composer-grid.no-mic { grid-template-columns: 1fr 38px; }
.panel-chat .composer textarea {
  width: 100%; border: 1.5px solid #e2e1dd; border-radius: 9px;
  padding: 9px 13px; font-family: inherit; font-size: 13.5px;
  background: #fff; color: #23252b;
  min-height: 38px; max-height: 140px; resize: none; overflow-y: hidden; line-height: 1.5;
}
.panel-chat .composer textarea:focus { outline: none; border-color: var(--b-accent); }
.panel-chat .composer textarea::placeholder { color: #9aa0a8; }
.panel-chat .composer .sq {
  width: 38px; height: 38px; border-radius: 9px;
  display: grid; place-items: center; cursor: pointer;
  border: none;
}
.panel-chat .composer .sq.send { background: #1f2228; color: #fff; }
.panel-chat .composer .sq.send:disabled { opacity: 0.4; cursor: not-allowed; }
.panel-chat .composer .sq.send:not(:disabled):hover { background: #32363e; }
.panel-chat .composer .sq.rec {
  background: #fff; color: var(--text-secondary);
  border: 1.5px solid #e2e1dd;
}
.panel-chat .composer .sq.rec.idle-pulse:not(.listening) {
  border-color: var(--b-accent); color: var(--b-accent);
  animation: pulseIdleMic 2s ease-in-out infinite;
}
@keyframes pulseIdleMic {
  0%, 100% { box-shadow: 0 0 0 0 rgba(31,34,40,0); }
  50%       { box-shadow: 0 0 0 5px rgba(31,34,40,0.12); }
}
.panel-chat .composer .sq.rec.listening {
  background: var(--b-accent); color: var(--b-on-accent); border-color: var(--b-accent);
  animation: pulseRec 1.6s ease-in-out infinite;
}
@keyframes pulseRec { 0%, 100% { box-shadow: 0 0 0 0 rgba(31,34,40,0); } 50% { box-shadow: 0 0 0 7px rgba(31,34,40,0.16); } }
.panel-chat .composer .hint {
  font-size: 10.5px; color: #9aa0a8; text-align: center; margin-top: 9px; letter-spacing: 0.03em;
}
.panel-chat .composer .hint.mic-error { color: var(--coral-600); font-weight: 500; }

/* Finish row */
.panel-chat .finish-row { display: flex; justify-content: center; padding: 18px 16px 8px; }
.panel-chat .finish-row.pending { color: #8a8f98; font-size: 12px; }
.panel-chat .finish-row .finish-btn {
  font-family: inherit; font-size: 14px; font-weight: 600;
  padding: 11px 22px; border-radius: 8px;
  background: #1f2228; color: #fff; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.15s, transform 0.15s;
}
.panel-chat .finish-row .finish-btn:hover { background: #32363e; transform: translateY(-1px); }

/* ============================================================
   REWARD (p04) — Banner skin (no header bar)
   ============================================================ */
.panel-reward {
  width: 420px; max-width: 100%;
  background: #fff; border-radius: 14px;
  box-shadow: 0 22px 56px rgba(20,22,26,0.2), 0 3px 10px rgba(20,22,26,0.07);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow: hidden; text-align: center;
  animation: reward-rise 0.5s ease-out;
  position: relative; z-index: 2;
}
@keyframes reward-rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.confetti { position: absolute; border-radius: 4px; opacity: 0.85; pointer-events: none; }
@keyframes fall {
  0%   { transform: translateY(0) rotate(0deg); opacity: 0.9; }
  90%  { opacity: 0.9; }
  100% { transform: translateY(780px) rotate(540deg); opacity: 0; }
}

/* Check area */
.panel-reward .check-area { padding: 30px 28px 4px; text-align: center; }
.panel-reward .check-big {
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--b-accent); color: var(--b-on-accent);
  display: grid; place-items: center; margin: 0 auto 14px;
  animation: pop 0.5s cubic-bezier(0.18, 1.04, 0.4, 1.4) 0.1s both;
}
@keyframes pop { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.panel-reward h1 {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 27px; letter-spacing: -0.01em; line-height: 1.12;
  margin: 0 0 8px; color: #23252b; text-wrap: balance;
}
.panel-reward h1 em { font-style: italic; }
.panel-reward .sub { font-size: 13.5px; color: #5c6068; margin: 0; line-height: 1.5; }

/* Reward card — dark */
.panel-reward .gc {
  margin: 20px 26px 0; padding: 18px 20px 16px;
  border-radius: 12px; background: #1f2228; color: var(--reward-ink);
  text-align: left;
}
.panel-reward .gc .tag {
  font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
  opacity: 0.65; color: var(--reward-accent);
}
.panel-reward .gc .amt {
  font-family: var(--b-display); font-weight: var(--b-display-weight);
  font-size: 27px; letter-spacing: -0.01em; line-height: 1.1;
  margin: 5px 0 0; color: var(--reward-accent);
}
.panel-reward .gc .code {
  margin-top: 14px; padding: 9px 12px;
  background: rgba(255,255,255,0.08);
  border: 1px dashed rgba(255,255,255,0.3);
  border-radius: 7px;
  font-family: var(--font-mono); font-size: 12.5px; letter-spacing: 0.08em;
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  color: var(--reward-ink);
}
.panel-reward .gc .code button {
  background: #fff; color: #1f2228; border: none;
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  padding: 5px 10px; border-radius: 4px; cursor: pointer; font-family: inherit; flex-shrink: 0;
}
.panel-reward .gc .code button.copied { background: var(--seaweed-500); color: #fff; }
.panel-reward .gc .email-note {
  margin-top: 11px; font-size: 11.5px; opacity: 0.65;
  display: flex; align-items: center; gap: 7px; color: var(--reward-ink);
}

/* CTAs */
.panel-reward .cta-row { padding: 18px 26px 8px; display: flex; flex-direction: column; gap: 4px; }
.panel-reward .cta-row button { font-family: inherit; cursor: pointer; border: none; border-radius: 8px; }
.panel-reward .cta-row .shop { padding: 13px 16px; background: #1f2228; color: #fff; font-size: 14px; font-weight: 600; }
.panel-reward .cta-row .shop:hover { background: #32363e; }
.panel-reward .cta-row .done { padding: 8px; background: transparent; color: #8a8f98; font-size: 12px; }
.panel-reward .cta-row .done:hover { color: #5c6068; }
.panel-reward .note {
  padding: 11px 26px 14px; font-size: 10.5px; color: #9aa0a8; letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: center; gap: 7px;
}
.panel-reward .note::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--b-accent); }

/* Error panel */
.panel-err {
  width: 420px; max-width: 100%;
  background: white; border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px 28px;
  animation: modal-rise var(--dur-slow) var(--ease-out);
  text-align: center;
}
.panel-err h3 { font-family: var(--font-display); font-weight: 900; font-size: 20px; margin: 0 0 8px; color: var(--text-primary); }
.panel-err p { font-size: 13.5px; color: var(--text-secondary); margin: 0 0 16px; }
.panel-err button {
  padding: 11px 18px; background: var(--coral-500); color: white;
  border: none; border-radius: var(--r-sm); font-family: inherit;
  font-size: 14px; font-weight: 500; cursor: pointer;
}

/* ============================================================
   AUDIO TOGGLE (Sprint 3 — WS-CORE-3-audio-per-tenant-toggle)
   ============================================================ */
/**
 * .bento-audio-hidden — applied when tenants.audio_enabled = false.
 * Uses visibility:hidden + pointer-events:none (NOT display:none) to
 * preserve layout so no reflow occurs. Safe-fail: if CSS is missing,
 * the mic button is still present but the widget layer skips MediaRecorder.
 */
.bento-audio-hidden {
  visibility: hidden;
  pointer-events: none;
}

/* ============================================================
   MOBILE (p06)
   ============================================================ */
@media (max-width: 540px) {
  .root.bottom-right { right: 12px; bottom: 12px; left: 12px; }
  .intercept { width: auto; max-width: 100%; }
  .panel-consent { width: 100%; max-height: calc(100vh - 24px); border-radius: 14px; }
  .panel-consent .c-offer { padding: 16px 20px; }
  .panel-consent .c-offer h2 { font-size: 22px; }
  .panel-consent .c-bullets { padding: 12px 20px; }
  .panel-consent .c-foot { padding: 14px 20px 18px; }
  .panel-chat { width: 100%; height: 100vh; max-height: 100vh; border-radius: 0; }
  .panel-reward { width: 100%; max-width: 100%; }
  .panel-reward .check-area { padding: 26px 22px 4px; }
  .panel-reward .gc { margin: 18px 20px 0; }
  .panel-reward .cta-row { padding: 16px 20px 8px; }
}
`;
  function supportsAdoptedStyleSheets() {
    try {
      return typeof CSSStyleSheet === "function" && typeof document.adoptedStyleSheets !== "undefined";
    } catch (e) {
      return false;
    }
  }
  function applyWidgetStyles(shadowRoot) {
    if (supportsAdoptedStyleSheets()) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(WIDGET_STYLES);
      shadowRoot.adoptedStyleSheets = [sheet];
      return null;
    }
    const style = document.createElement("style");
    const nonceMeta = document.head.querySelector('meta[name="csp-nonce"]');
    if (nonceMeta) {
      style.nonce = nonceMeta.content;
    }
    style.textContent = WIDGET_STYLES;
    shadowRoot.appendChild(style);
    return style;
  }
  function ensureFontsLoaded() {
    if (typeof document === "undefined") return;
    if (!document.getElementById("bento-preconnect-googleapis")) {
      const pc1 = document.createElement("link");
      pc1.id = "bento-preconnect-googleapis";
      pc1.rel = "preconnect";
      pc1.href = "https://fonts.googleapis.com";
      document.head.appendChild(pc1);
    }
    if (!document.getElementById("bento-preconnect-gstatic")) {
      const pc2 = document.createElement("link");
      pc2.id = "bento-preconnect-gstatic";
      pc2.rel = "preconnect";
      pc2.href = "https://fonts.gstatic.com";
      pc2.crossOrigin = "anonymous";
      document.head.appendChild(pc2);
    }
    if (!document.getElementById("bento-fonts")) {
      const link = document.createElement("link");
      link.id = "bento-fonts";
      link.rel = "stylesheet";
      link.href = WIDGET_FONTS_HREF;
      document.head.appendChild(link);
    }
  }
  const BENTO_COLOR_PRIMARY_VAR = "--bento-color-primary";
  const BENTO_LOCKUP_ID = "bento-powered-lockup";
  function readBrandingState(sessionResponse) {
    var _a, _b, _c, _d;
    const rawTier = sessionResponse == null ? void 0 : sessionResponse.branding_tier;
    const tier = rawTier === "paid" ? "paid" : rawTier === "enterprise" ? "enterprise" : "pilot";
    const rawConfig = (_a = sessionResponse == null ? void 0 : sessionResponse.branding_config) != null ? _a : null;
    const config = {
      logo_url: (_b = rawConfig == null ? void 0 : rawConfig.logo_url) != null ? _b : null,
      font_family: (_c = rawConfig == null ? void 0 : rawConfig.font_family) != null ? _c : null,
      accent_color: (_d = rawConfig == null ? void 0 : rawConfig.accent_color) != null ? _d : null
    };
    return { tier, config };
  }
  function isValidHexColor(value) {
    if (!value) return false;
    return /^#[0-9A-Fa-f]{6}$/.test(value);
  }
  function applyBranding(shadowRoot, branding) {
    const { tier, config } = branding;
    if (tier === "pilot") {
      ensurePoweredByLockup(shadowRoot);
      return;
    }
    removePoweredByLockup(shadowRoot);
    if (config.logo_url) {
      applyLogoUrl(shadowRoot, config.logo_url);
    }
    if (config.font_family) {
      applyFontFamily(shadowRoot, config.font_family);
    }
    if (isValidHexColor(config.accent_color)) {
      applyAccentColor(shadowRoot, config.accent_color);
    }
  }
  function ensurePoweredByLockup(shadowRoot) {
    const existing = shadowRoot.getElementById(BENTO_LOCKUP_ID);
    if (existing) return existing;
    const lockup = document.createElement("div");
    lockup.id = BENTO_LOCKUP_ID;
    lockup.className = "saga-powered-lockup";
    lockup.setAttribute("aria-label", "Powered by Saga");
    lockup.textContent = "Powered by Saga";
    shadowRoot.appendChild(lockup);
    return lockup;
  }
  function removePoweredByLockup(shadowRoot) {
    const lockup = shadowRoot.getElementById(BENTO_LOCKUP_ID);
    if (lockup) {
      lockup.remove();
    }
  }
  function applyLogoUrl(shadowRoot, logoUrl) {
    const slots = shadowRoot.querySelectorAll("img.brand-logo");
    if (slots.length > 0) {
      slots.forEach((img) => {
        img.src = logoUrl;
        img.setAttribute("data-widget-logo", "");
        img.style.display = "block";
      });
      shadowRoot.querySelectorAll(".brand-wordmark").forEach((wm) => {
        wm.style.display = "none";
      });
      return;
    }
    let logoEl = shadowRoot.querySelector("[data-widget-logo]");
    if (!logoEl) {
      logoEl = document.createElement("img");
      logoEl.setAttribute("data-widget-logo", "");
      logoEl.setAttribute("alt", "tenant logo");
      logoEl.className = "brand-logo";
      logoEl.style.display = "none";
      shadowRoot.appendChild(logoEl);
    }
    logoEl.src = logoUrl;
  }
  function applyFontFamily(shadowRoot, fontFamily) {
    const host = shadowRoot.host;
    host.style.setProperty("--bento-font-family", fontFamily);
  }
  function applyAccentColor(shadowRoot, accentColor) {
    const host = shadowRoot.host;
    host.style.setProperty(BENTO_COLOR_PRIMARY_VAR, accentColor);
  }
  const SessionState = {
    UNINITIALIZED: "UNINITIALIZED",
    INITIALIZING: "INITIALIZING",
    READY: "READY",
    INTERCEPT_SHOWN: "INTERCEPT_SHOWN",
    CONSENT: "CONSENT",
    SESSION_ACTIVE: "SESSION_ACTIVE",
    SESSION_COMPLETING: "SESSION_COMPLETING",
    SESSION_COMPLETED: "SESSION_COMPLETED",
    SESSION_REVOKED: "SESSION_REVOKED",
    SESSION_EXPIRED: "SESSION_EXPIRED",
    SESSION_CLOSED: "SESSION_CLOSED",
    TOKEN_INVALID: "TOKEN_INVALID",
    ORIGIN_BLOCKED: "ORIGIN_BLOCKED",
    TOKEN_ERROR: "TOKEN_ERROR"
  };
  const SessionEvent = {
    READY: "saga:ready",
    INTERCEPT_SHOWN: "saga:intercept-shown",
    INTERCEPT_DISMISSED: "saga:intercept-dismissed",
    SESSION_STARTED: "saga:session-started",
    MESSAGE_RECEIVED: "saga:message-received",
    SESSION_COMPLETED: "saga:session-completed",
    SESSION_CLOSED: "saga:session-closed",
    SESSION_REVOKED: "saga:session-revoked",
    AUDIO_CAPTURE_STARTED: "saga:audio-capture-started",
    AUDIO_CAPTURE_FAILED: "saga:audio-capture-failed",
    AUDIO_UNAVAILABLE: "saga:audio-unavailable",
    ERROR: "saga:error",
    WARN: "saga:warn"
  };
  const TERMINAL_STATES = /* @__PURE__ */ new Set([
    SessionState.TOKEN_INVALID,
    SessionState.ORIGIN_BLOCKED,
    SessionState.TOKEN_ERROR,
    SessionState.SESSION_REVOKED,
    SessionState.SESSION_EXPIRED,
    SessionState.SESSION_CLOSED,
    SessionState.SESSION_COMPLETED
  ]);
  const API_BASE_URL_TEST = "https://api-sandbox.bentobox.dev";
  function buildMockResponse(behavior) {
    switch (behavior) {
      case "200-ok":
        return new Response(
          JSON.stringify({
            sessionToken: "st_test_mock_ok",
            expiresIn: 1800,
            incentive_config: { type: "gift-card", amount_usd: 5 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      case "401-revoked":
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      case "403-origin":
        return new Response(JSON.stringify({ error: "forbidden", code: "ORIGIN_NOT_ALLOWLISTED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      case "403-revoked":
        return new Response(JSON.stringify({ error: "forbidden", code: "TOKEN_REVOKED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      case "410-expired":
        return new Response(JSON.stringify({ error: "session_expired" }), {
          status: 410,
          headers: { "Content-Type": "application/json" }
        });
      case "503-server-error":
        return new Response(JSON.stringify({ error: "service_unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      default:
        return new Response(JSON.stringify({ error: "bad_request", code: "UNKNOWN_BEHAVIOR" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
    }
  }
  class SessionStateMachineImpl {
    constructor(eventTarget) {
      this._state = SessionState.UNINITIALIZED;
      this.client = null;
      this.sessionToken = null;
      this.clientToken = null;
      this._sessionResponse = null;
      this.revocationInFlight = null;
      this._sendChain = Promise.resolve();
      this._mockBehavior = void 0;
      this._inviteCode = void 0;
      this._apiBase = API_BASE_URL_TEST;
      this.eventTarget = eventTarget;
    }
    get state() {
      return this._state;
    }
    emit(eventName, detail) {
      this.eventTarget.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
    transition(newState) {
      this._state = newState;
    }
    async mount(options) {
      if (TERMINAL_STATES.has(this._state)) {
        throw new Error(`mount() called from terminal state "${this._state}" — cannot re-mount`);
      }
      this.transition(SessionState.INITIALIZING);
      this.clientToken = options.token;
      this._inviteCode = options.inviteCode;
      const behavior = options._mockBehavior;
      this._mockBehavior = behavior;
      const fetchIsExternallyMocked = behavior !== void 0 && typeof fetch.mock === "object";
      if (behavior !== void 0 && !fetchIsExternallyMocked) {
        const mockFetch = (_url, _init) => Promise.resolve(buildMockResponse(behavior));
        await this._mountWithFetch(options.token, mockFetch, options.apiBase);
      } else {
        await this._mountWithFetch(options.token, fetch, options.apiBase);
      }
    }
    async _mountWithFetch(token, fetchFn, apiBase) {
      const baseUrl = apiBase != null ? apiBase : API_BASE_URL_TEST;
      this._apiBase = baseUrl;
      try {
        let res;
        try {
          res = await fetchFn(`${baseUrl}/v1/sessions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
            // Server requires client_id on create (a cheap insert — the moderator is
            // started later by POST /:token/start). Response is camelCase (sessionToken).
            // invite_code (demo links only) lets the server enforce the per-customer cap.
            body: JSON.stringify({
              client_id: token,
              ...this._inviteCode ? { invite_code: this._inviteCode } : {}
            })
          });
        } catch (err) {
          this.transition(SessionState.TOKEN_ERROR);
          this.emit(SessionEvent.ERROR, { code: "NETWORK_ERROR", message: String(err) });
          return;
        }
        if (res.status === 200) {
          const body = await res.json();
          this.sessionToken = body.sessionToken;
          this._sessionResponse = body;
          this.client = new SessionApiClient({ baseUrl: API_BASE_URL_TEST });
          this.transition(SessionState.READY);
          this.emit(SessionEvent.READY);
          return;
        }
        if (res.status === 401) {
          this.transition(SessionState.TOKEN_INVALID);
          return;
        }
        if (res.status === 403) {
          let code;
          try {
            const body = await res.json();
            code = typeof body.code === "string" ? body.code : void 0;
          } catch (e) {
          }
          if (code === "ORIGIN_NOT_ALLOWLISTED") {
            this.transition(SessionState.ORIGIN_BLOCKED);
          } else {
            this.transition(SessionState.TOKEN_INVALID);
          }
          return;
        }
        if (res.status === 410) {
          this.transition(SessionState.SESSION_EXPIRED);
          this.emit(SessionEvent.ERROR, { code: "SESSION_EXPIRED" });
          return;
        }
        this.transition(SessionState.TOKEN_ERROR);
        this.emit(SessionEvent.ERROR, { code: "SERVER_ERROR", status: res.status });
      } catch (err) {
        this.transition(SessionState.TOKEN_ERROR);
        this.emit(SessionEvent.ERROR, { code: "UNKNOWN_ERROR", message: String(err) });
      }
    }
    triggerDwellExpiry() {
      if (this._state !== SessionState.READY) return Promise.resolve();
      this.transition(SessionState.INTERCEPT_SHOWN);
      this.emit(SessionEvent.INTERCEPT_SHOWN);
      return Promise.resolve();
    }
    clickIntercept() {
      if (this._state !== SessionState.INTERCEPT_SHOWN) return Promise.resolve();
      this.transition(SessionState.CONSENT);
      return Promise.resolve();
    }
    dismissIntercept() {
      if (this._state !== SessionState.INTERCEPT_SHOWN) return Promise.resolve();
      this.transition(SessionState.READY);
      this.emit(SessionEvent.INTERCEPT_DISMISSED);
      return Promise.resolve();
    }
    acceptConsent() {
      if (this._state !== SessionState.CONSENT) return Promise.resolve();
      this.transition(SessionState.SESSION_ACTIVE);
      this.emit(SessionEvent.SESSION_STARTED);
      return Promise.resolve();
    }
    /** Returns the full /v1/sessions response (for branding + audio_enabled reads). */
    getSessionResponse() {
      return this._sessionResponse;
    }
    /** Returns the LIVE session token (rotates on refresh — read on each use). */
    getSessionToken() {
      return this.sessionToken;
    }
    completeSession() {
      if (this._state !== SessionState.SESSION_ACTIVE) return Promise.resolve();
      this.transition(SessionState.SESSION_COMPLETING);
      if (this._mockBehavior !== void 0) {
        this.transition(SessionState.SESSION_COMPLETED);
        this.emit(SessionEvent.SESSION_COMPLETED);
        return Promise.resolve();
      }
      this.transition(SessionState.SESSION_COMPLETED);
      this.emit(SessionEvent.SESSION_COMPLETED);
      return Promise.resolve();
    }
    handleSpaNavigation() {
      if (TERMINAL_STATES.has(this._state)) return Promise.resolve();
      this.transition(SessionState.SESSION_CLOSED);
      this.emit(SessionEvent.SESSION_CLOSED, { reason: "spa-navigation" });
      return Promise.resolve();
    }
    async receiveApiResponse(response) {
      if (response.status === 410) {
        if (this._state !== SessionState.SESSION_REVOKED) {
          this.transition(SessionState.SESSION_EXPIRED);
          this.emit(SessionEvent.ERROR, { code: "SESSION_EXPIRED" });
        }
        return;
      }
      if (response.status === 401) {
        await this._handleMidSessionUnauthorized();
      }
    }
    /**
     * Sends a message in an active session, with silent refresh on 401.
     *
     * Concurrency contract (staff-engineer spec):
     * - Calls are chained: each new call waits for the previous to complete.
     * - This ensures the first call's 401→refresh is fully processed before
     *   the second call's fetch fires.
     * - At most ONE refresh in flight at a time (revocationInFlight promise).
     */
    sendMessage(params) {
      this._sendChain = this._sendChain.then(() => this._doSendMessage(params));
      return this._sendChain;
    }
    async _doSendMessage(params) {
      var _a, _b, _c, _d;
      if (this._state !== SessionState.SESSION_ACTIVE) return;
      if (this.revocationInFlight !== null) {
        await this.revocationInFlight;
        const stateAfterRefresh = this._state;
        if (stateAfterRefresh !== SessionState.SESSION_ACTIVE) return;
      }
      const baseUrl = this._apiBase;
      const token = (_a = this.sessionToken) != null ? _a : "";
      let res;
      try {
        res = await fetch(`${baseUrl}/v1/sessions/${token}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ content: params.text })
        });
      } catch (err) {
        this.emit(SessionEvent.ERROR, { code: "NETWORK_ERROR", message: String(err) });
        return;
      }
      if (res.status === 401) {
        await this._handleMidSessionUnauthorized();
        return;
      }
      if (res.status === 410) {
        this.transition(SessionState.SESSION_EXPIRED);
        this.emit(SessionEvent.ERROR, { code: "SESSION_EXPIRED" });
        return;
      }
      if (res.status === 429) {
        this.emit(SessionEvent.ERROR, { code: "RATE_LIMITED" });
        return;
      }
      if (!res.ok) {
        this.emit(SessionEvent.ERROR, { code: "SEND_FAILED", status: res.status });
        return;
      }
      let body;
      try {
        body = await res.json();
      } catch (e) {
        return;
      }
      const agentReply = (_b = body.agentReply) != null ? _b : "";
      const isComplete = (_c = body.isComplete) != null ? _c : false;
      const turnIndex = (_d = body.turnIndex) != null ? _d : 0;
      const progress = body.progress;
      this.emit(SessionEvent.MESSAGE_RECEIVED, {
        agentReply,
        isComplete,
        turnIndex,
        ...progress !== void 0 ? { progress } : {}
      });
    }
    /**
     * Handles a mid-session 401 by attempting a silent refresh.
     * Only one refresh in flight at a time (revocationInFlight promise).
     * 5s timeout → SESSION_REVOKED.
     *
     * The refresh is started immediately (synchronous call to fetch + setTimeout),
     * so the timeout is registered before any async boundary — compatible with
     * vitest fake timers.
     */
    _handleMidSessionUnauthorized() {
      var _a;
      if (this.revocationInFlight !== null) {
        return this.revocationInFlight;
      }
      const baseUrl = this._apiBase;
      const token = (_a = this.sessionToken) != null ? _a : "";
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("REFRESH_TIMEOUT"));
        }, 5e3);
      });
      const refreshFetchPromise = fetch(`${baseUrl}/v1/sessions/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ session_token: token })
      });
      const refreshFlow = Promise.race([refreshFetchPromise, timeoutPromise]).then(async (res) => {
        if (res.status === 200) {
          const body = await res.json();
          this.sessionToken = body.sessionToken;
        } else {
          this.transition(SessionState.SESSION_REVOKED);
          this.emit(SessionEvent.SESSION_REVOKED);
        }
      }).catch(() => {
        this.transition(SessionState.SESSION_REVOKED);
        this.emit(SessionEvent.SESSION_REVOKED);
      }).finally(() => {
        this.revocationInFlight = null;
      });
      this.revocationInFlight = refreshFlow;
      return refreshFlow;
    }
  }
  function createSessionStateMachine(eventTarget) {
    return new SessionStateMachineImpl(eventTarget);
  }
  const AUDIO_DISABLED_REASON = "TENANT_DISABLED";
  function hideMicElements(shadowRoot) {
    const micElements = shadowRoot.querySelectorAll(".sq.rec, [data-bento-mic]");
    micElements.forEach((el) => {
      el.classList.add("bento-audio-hidden");
    });
    const textarea = shadowRoot.querySelector(".composer textarea");
    if (textarea) textarea.placeholder = "Type your answer…";
    const hint = shadowRoot.querySelector(".composer .hint");
    if (hint) hint.textContent = "answers stay private";
  }
  function emitAudioDisabled(eventTarget) {
    eventTarget.dispatchEvent(
      new CustomEvent(SessionEvent.AUDIO_UNAVAILABLE, {
        detail: { reason: AUDIO_DISABLED_REASON },
        bubbles: true,
        composed: true
      })
    );
  }
  function readAudioEnabled(sessionResponse) {
    if (!sessionResponse) return true;
    return sessionResponse.audio_enabled !== false;
  }
  const PHASES = [
    { phase: 1, phaseEnum: "WARMING_UP", phaseLabel: "Warming Up" },
    { phase: 2, phaseEnum: "EXPLORING", phaseLabel: "Exploring" },
    { phase: 3, phaseEnum: "PROBING", phaseLabel: "Probing" },
    { phase: 4, phaseEnum: "WRAPPING_UP", phaseLabel: "Wrapping Up" }
  ];
  const PHASE_CHANGED_EVENT = "saga:phase-changed";
  function phaseFromTurnCount(turnCount) {
    if (turnCount <= 2) return 1;
    if (turnCount <= 5) return 2;
    if (turnCount <= 8) return 3;
    return 4;
  }
  function phaseNumberFromState(state) {
    switch (state) {
      case "WARMING_UP":
        return 1;
      case "EXPLORING":
        return 2;
      case "PROBING":
        return 3;
      case "WRAPPING_UP":
      case "COMPLETE":
        return 4;
      default:
        return null;
    }
  }
  function getPhaseInfo(phase) {
    const info = PHASES[phase - 1];
    if (!info) throw new Error(`getPhaseInfo: invalid phase ${phase.toString()}`);
    return info;
  }
  class PhaseProgressTracker {
    constructor(eventTarget) {
      this._currentPhase = 1;
      this._turnCount = 0;
      this._eventTarget = eventTarget;
    }
    get currentPhase() {
      return this._currentPhase;
    }
    get currentPhaseInfo() {
      return getPhaseInfo(this._currentPhase);
    }
    get turnCount() {
      return this._turnCount;
    }
    /**
     * recordTurn — called after each full turn (moderator + participant exchange).
     * Evaluates whether the phase should advance and fires saga:phase-changed if so.
     */
    recordTurn() {
      this._turnCount += 1;
      const newPhase = phaseFromTurnCount(this._turnCount);
      if (newPhase !== this._currentPhase) {
        const from = this._currentPhase;
        const to = newPhase;
        this._currentPhase = newPhase;
        const phaseInfo = getPhaseInfo(newPhase);
        this._eventTarget.dispatchEvent(
          new CustomEvent(PHASE_CHANGED_EVENT, {
            detail: {
              from,
              to,
              phase: newPhase,
              phaseLabel: phaseInfo.phaseLabel
            },
            bubbles: true,
            composed: true
          })
        );
      }
    }
    /**
     * forcePhase — directly sets the phase (for external orchestration or wrapping-up signal).
     * Fires saga:phase-changed if the phase actually changes.
     */
    forcePhase(phase) {
      if (phase === this._currentPhase) return;
      const from = this._currentPhase;
      this._currentPhase = phase;
      const phaseInfo = getPhaseInfo(phase);
      this._eventTarget.dispatchEvent(
        new CustomEvent(PHASE_CHANGED_EVENT, {
          detail: {
            from,
            to: phase,
            phase,
            phaseLabel: phaseInfo.phaseLabel
          },
          bubbles: true,
          composed: true
        })
      );
    }
    /** Reset to initial state (e.g., for test cleanup). */
    reset() {
      this._currentPhase = 1;
      this._turnCount = 0;
    }
  }
  const DEFAULT_API_BASE = "http://localhost:3001";
  const DEFAULT_DWELL_MS = 3e3;
  class SagaWidgetElement extends HTMLElement {
    constructor() {
      super();
      this._controller = null;
      this._dwellTimer = null;
      this._phaseTracker = null;
      this._spaHandler = null;
      this._stateMachine = null;
      this._restoreFetch = null;
      this._minimizedPillHost = null;
      this._displayName = "Saga";
      this._onSessionExpired = null;
      this._onMessageReceived = null;
      this._onSendFailed = null;
      this._shadowRoot = this.attachShadow({ mode: "open" });
    }
    /** PM-locked observed attributes */
    static get observedAttributes() {
      return [
        "data-client-id",
        "data-display-name",
        "data-tenant-id",
        "data-api-base",
        "data-sandbox-mode",
        "data-dwell-ms",
        "data-locale"
      ];
    }
    /**
     * __debug — dev-only debug surface. Exposed only when data-sandbox-mode="1".
     * Used by SUBSYSTEM_STATE_VERIFICATION_PROTOCOL smoke scripts to inspect
     * subsystem state without reaching into private fields.
     *
     * NOT present in production builds (gated by attribute check at access time).
     * DO NOT use in application code.
     */
    get __debug() {
      if (this.getAttribute("data-sandbox-mode") !== "1") return null;
      return { stateMachine: this._stateMachine };
    }
    connectedCallback() {
      var _a;
      applyWidgetStyles(this._shadowRoot);
      ensureFontsLoaded();
      this._applyBrandTheme();
      this._spaHandler = () => {
        this._destroy();
      };
      window.addEventListener("pagehide", this._spaHandler);
      const dwellMs = parseInt((_a = this.getAttribute("data-dwell-ms")) != null ? _a : String(DEFAULT_DWELL_MS), 10);
      const safeDwellMs = isNaN(dwellMs) ? DEFAULT_DWELL_MS : Math.max(0, dwellMs);
      if (safeDwellMs === 0) {
        void this._boot();
      } else {
        this._dwellTimer = setTimeout(() => {
          this._dwellTimer = null;
          void this._boot();
        }, safeDwellMs);
      }
    }
    disconnectedCallback() {
      if (this._spaHandler) {
        window.removeEventListener("pagehide", this._spaHandler);
        this._spaHandler = null;
      }
      this._destroy();
    }
    /**
     * Apply per-client brand colors/fonts to the ACTUAL CSS variables the styles use
     * (--coral-500/600 accent, --ink dark header, --font-display headings). Driven by
     * data attributes on the host so any client can theme the widget, and the site
     * brand-scraper (task #47) populates them automatically. Inline host vars override
     * the :host defaults. Only valid #RRGGBB colors are applied.
     */
    _applyBrandTheme() {
      const host = this._shadowRoot.host;
      const HEX = /^#[0-9a-fA-F]{6}$/;
      const accent = this.getAttribute("data-accent-color");
      const dark = this.getAttribute("data-brand-dark");
      const font = this.getAttribute("data-brand-font");
      if (accent && HEX.test(accent)) {
        host.style.setProperty("--coral-500", accent);
        host.style.setProperty("--coral-600", accent);
      }
      if (dark && HEX.test(dark)) {
        host.style.setProperty("--ink", dark);
      }
      if (font && font.trim().length > 0) {
        host.style.setProperty("--font-display", font);
      }
    }
    async _boot() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      const clientId = (_a = this.getAttribute("data-client-id")) != null ? _a : "";
      if (!clientId) {
        return;
      }
      const displayName = (_b = this.getAttribute("data-display-name")) != null ? _b : "Bento";
      this._displayName = displayName;
      const tenantId = (_c = this.getAttribute("data-tenant-id")) != null ? _c : "";
      const apiBase = (_d = this.getAttribute("data-api-base")) != null ? _d : DEFAULT_API_BASE;
      const locale = (_e = this.getAttribute("data-locale")) != null ? _e : "en";
      const brandLogo = (_f = this.getAttribute("data-brand-logo")) != null ? _f : "";
      const rubric = this.getAttribute("data-rubric") === "acquisition" ? "acquisition" : "retention";
      const incentiveLabel = (_g = this.getAttribute("data-incentive-label")) != null ? _g : "";
      let incentive = {
        enabled: incentiveLabel.trim().length > 0,
        label: incentiveLabel
      };
      const demoScript = this.getAttribute("data-demo-script");
      if (demoScript) this._restoreFetch = installScriptedDemo(demoScript, apiBase);
      const apiClient = new SessionApiClient({ baseUrl: apiBase });
      const stateMachine = createSessionStateMachine(this);
      this._stateMachine = stateMachine;
      const inviteCode = ((_h = this.getAttribute("data-invite-code")) == null ? void 0 : _h.trim()) || void 0;
      await stateMachine.mount({ token: clientId, apiBase, ...inviteCode ? { inviteCode } : {} });
      const mountedState = stateMachine.state;
      const isTerminalError = mountedState === SessionState.TOKEN_INVALID || mountedState === SessionState.ORIGIN_BLOCKED || mountedState === SessionState.TOKEN_ERROR || mountedState === SessionState.SESSION_EXPIRED;
      if (isTerminalError) {
        if (stateMachine.state === SessionState.TOKEN_INVALID) {
          this.dispatchEvent(
            new CustomEvent(SessionEvent.ERROR, { detail: { code: "TOKEN_INVALID" } })
          );
        } else if (stateMachine.state === SessionState.ORIGIN_BLOCKED) {
          this.dispatchEvent(
            new CustomEvent(SessionEvent.ERROR, { detail: { code: "ORIGIN_BLOCKED" } })
          );
        }
        return;
      }
      const phaseTracker = new PhaseProgressTracker(this);
      this._phaseTracker = phaseTracker;
      let currentSessionToken = null;
      let audioEnabled = true;
      const bridge = createSessionBridge();
      const self = this;
      const wrappedBridge = {
        mountIntercept(host, onShown, onDismissed) {
          const interceptHost = document.createElement("div");
          interceptHost.className = "root bottom-right";
          interceptHost.setAttribute("data-surface", "intercept");
          host.appendChild(interceptHost);
          renderIntercept(interceptHost, {
            brandName: displayName,
            ...brandLogo ? { logoUrl: brandLogo } : {},
            rubric,
            incentive,
            onAccept: () => {
              interceptHost.remove();
              onShown();
            },
            onDismiss: () => {
              interceptHost.remove();
              onDismissed();
            }
          });
          self._wireMinimize(interceptHost);
        },
        mountConsent(host, ctx) {
          var _a2;
          const consentHost = document.createElement("div");
          consentHost.className = "root bottom-right";
          consentHost.setAttribute("data-surface", "consent");
          (_a2 = host.querySelector("[data-surface]")) == null ? void 0 : _a2.remove();
          host.appendChild(consentHost);
          return new Promise((resolve) => {
            renderConsent({
              host: consentHost,
              brandName: ctx.displayName,
              ...brandLogo ? { logoUrl: brandLogo } : {},
              termsUrl: ctx.termsUrl,
              rubric,
              incentive,
              onAccepted(result) {
                consentHost.remove();
                resolve({ accepted: true, ...result });
                return Promise.resolve();
              },
              onClose: () => {
                consentHost.remove();
                self._destroy();
                resolve({ accepted: false, consentVersion: "", consentAcceptedAt: "" });
              }
            });
            self._wireMinimize(consentHost);
          });
        },
        mountChat(host, opening) {
          var _a2;
          const chatHost = document.createElement("div");
          chatHost.className = "root bottom-right";
          chatHost.setAttribute("data-surface", "chat");
          (_a2 = host.querySelector("[data-surface]")) == null ? void 0 : _a2.remove();
          host.appendChild(chatHost);
          const wrappedOnSend = wrapSendWithAudioUpload({
            audioApi: {
              async audioUploadUrl(sessionId, turnIndex, contentType) {
                const res = await fetch(`${apiBase}/widget/upload-url`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId, turnIndex, contentType })
                });
                if (!res.ok) throw new Error(`upload-url ${res.status.toString()}`);
                return res.json();
              },
              async audioCommit(sessionId, turnIndex, durationMs) {
                const res = await fetch(
                  `${apiBase}/v1/recordings/${sessionId}/${turnIndex.toString()}/commit`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ durationMs })
                  }
                );
                if (!res.ok) throw new Error(`commit ${res.status.toString()}`);
                return res.json();
              }
            },
            getSessionToken: () => {
              var _a3;
              return (_a3 = stateMachine.getSessionToken()) != null ? _a3 : currentSessionToken;
            },
            onPendingAudioUpload: (p) => {
              if (self._controller) {
                self._controller.pendingAudioUpload = p;
              }
            },
            onSend: async (text) => {
              if (self._controller) {
                await self._controller.sendMessage(text);
              }
            }
          });
          const handle = mountChat(chatHost, {
            brandName: displayName,
            ...brandLogo ? { logoUrl: brandLogo } : {},
            locale,
            onSend: wrappedOnSend,
            onFinish: async () => {
              if (self._controller) {
                await self._controller.handleFinish();
              }
            },
            onClose: () => {
              self._destroy();
            }
          });
          self._wireMinimize(chatHost);
          if (opening) {
            handle.appendTurn({ role: "agent", text: opening });
          }
          if (!audioEnabled) {
            hideMicElements(host);
          } else if (typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined") {
            CODEC_CASCADE.some((mime) => window.MediaRecorder.isTypeSupported(mime));
          }
          return {
            appendTurn(turn) {
              handle.appendTurn(turn);
            },
            setThinking(thinking) {
              handle.setThinking(thinking);
            },
            setProgressPhase(phase) {
              const n = phaseNumberFromState(phase);
              if (n === null) return;
              handle.setProgressPhase(n);
              if (n > phaseTracker.currentPhase) phaseTracker.forcePhase(n);
            },
            setDone(done, outcome) {
              handle.setDone(done, outcome);
              if (done) {
                phaseTracker.forcePhase(4);
              }
            },
            failSend(notice) {
              handle.failSend(notice);
            },
            destroy() {
              handle.destroy();
            }
          };
        },
        mountReward(host, ctx) {
          var _a2;
          const rewardHost = document.createElement("div");
          rewardHost.className = "root bottom-right";
          rewardHost.setAttribute("data-surface", "reward");
          (_a2 = host.querySelector("[data-surface]")) == null ? void 0 : _a2.remove();
          host.appendChild(rewardHost);
          renderReward(rewardHost, {
            ...ctx.incentiveCode !== void 0 ? { incentiveCode: ctx.incentiveCode } : {},
            outcome: ctx.outcome,
            brandName: displayName,
            onClose: () => {
              self._destroy();
            }
          });
        },
        destroy() {
          bridge.destroy();
        }
      };
      const spotlight = (_i = this.getAttribute("data-spotlight")) != null ? _i : void 0;
      const controllerOpts = {
        clientId,
        displayName,
        tenantId,
        apiBase,
        interceptToken: clientId,
        ...spotlight ? { spotlight } : {}
      };
      const controller = new WidgetController(stateMachine, apiClient, wrappedBridge, controllerOpts);
      this._controller = controller;
      const sessionResponse = stateMachine.getSessionResponse();
      currentSessionToken = (_j = sessionResponse == null ? void 0 : sessionResponse.sessionToken) != null ? _j : null;
      audioEnabled = readAudioEnabled(sessionResponse);
      if (!audioEnabled) {
        emitAudioDisabled(this);
      }
      const brandingState = readBrandingState(
        sessionResponse
      );
      applyBranding(this._shadowRoot, brandingState);
      const serverIncentiveLabel = (_k = sessionResponse == null ? void 0 : sessionResponse.incentive_config) == null ? void 0 : _k.displayLabel;
      if (serverIncentiveLabel && serverIncentiveLabel.trim().length > 0) {
        incentive = { enabled: true, label: serverIncentiveLabel };
      }
      const onSessionExpired = (evt) => {
        const detail = evt.detail;
        if (!detail || detail.code !== "SESSION_EXPIRED") return;
        controller.destroy();
        while (this._shadowRoot.firstChild) {
          this._shadowRoot.removeChild(this._shadowRoot.firstChild);
        }
        const expiredHost = document.createElement("div");
        expiredHost.className = "root bottom-right";
        expiredHost.setAttribute("data-surface", "session-expired");
        this._shadowRoot.appendChild(expiredHost);
        renderSessionExpired(
          expiredHost,
          // "Start over" — trigger a fresh boot() without reloading the page.
          () => {
            while (this._shadowRoot.firstChild) {
              this._shadowRoot.removeChild(this._shadowRoot.firstChild);
            }
            this._controller = null;
            void this._boot();
          },
          // "Close" — destroy the widget entirely.
          () => {
            this._destroy();
          }
        );
      };
      if (this._onSessionExpired)
        this.removeEventListener(SessionEvent.ERROR, this._onSessionExpired);
      this._onSessionExpired = onSessionExpired;
      this.addEventListener(SessionEvent.ERROR, onSessionExpired);
      const onMessageReceived = (evt) => {
        const detail = evt.detail;
        if (!detail) return;
        controller.handleMessageReceived(detail);
      };
      if (this._onMessageReceived) {
        this.removeEventListener(SessionEvent.MESSAGE_RECEIVED, this._onMessageReceived);
      }
      this._onMessageReceived = onMessageReceived;
      this.addEventListener(SessionEvent.MESSAGE_RECEIVED, onMessageReceived);
      const onSendFailed = (evt) => {
        var _a2;
        const code = (_a2 = evt.detail) == null ? void 0 : _a2.code;
        if (code === "SEND_FAILED" || code === "NETWORK_ERROR" || code === "RATE_LIMITED") {
          controller.handleSendFailed(code);
        }
      };
      if (this._onSendFailed) this.removeEventListener(SessionEvent.ERROR, this._onSendFailed);
      this._onSendFailed = onSendFailed;
      this.addEventListener(SessionEvent.ERROR, onSendFailed);
      await stateMachine.triggerDwellExpiry();
      void controller.boot(this._shadowRoot);
    }
    /**
     * Minimize ⇄ restore, owned at the widget level so the SAME collapse-to-pill
     * behavior works on every surface (intercept, consent, chat) — not just chat.
     * Minimizing hides the active surface's positioned container and reveals one
     * shared corner pill; the surface DOM + session stay intact, so restoring
     * re-opens exactly where the participant left off.
     */
    _wireMinimize(surfaceHost) {
      if (this._minimizedPillHost) this._minimizedPillHost.hidden = true;
      surfaceHost.querySelectorAll(".min").forEach((btn) => {
        btn.addEventListener("click", () => {
          this._minimize();
        });
      });
    }
    _minimize() {
      const surface = this._shadowRoot.querySelector("[data-surface]");
      if (surface) surface.style.display = "none";
      this._ensurePill().hidden = false;
    }
    _restore() {
      const surface = this._shadowRoot.querySelector("[data-surface]");
      if (surface) surface.style.display = "";
      if (this._minimizedPillHost) this._minimizedPillHost.hidden = true;
    }
    /** Lazily build the shared restore pill (recreating it if a reboot cleared the DOM). */
    _ensurePill() {
      var _a, _b;
      if ((_a = this._minimizedPillHost) == null ? void 0 : _a.isConnected) return this._minimizedPillHost;
      const pillHost = document.createElement("div");
      pillHost.className = "root bottom-right";
      pillHost.hidden = true;
      pillHost.innerHTML = `
      <button class="min-bubble" type="button" aria-label="Reopen ${escapeAttr(this._displayName)} feedback">
        <span class="bubble-label">Share your thoughts</span>
        <span class="bubble-caret">${CARET_UP_SVG}</span>
      </button>
    `;
      (_b = pillHost.querySelector(".min-bubble")) == null ? void 0 : _b.addEventListener("click", () => {
        this._restore();
      });
      this._shadowRoot.appendChild(pillHost);
      this._minimizedPillHost = pillHost;
      return pillHost;
    }
    _destroy() {
      if (this._dwellTimer !== null) {
        clearTimeout(this._dwellTimer);
        this._dwellTimer = null;
      }
      if (this._restoreFetch) {
        this._restoreFetch();
        this._restoreFetch = null;
      }
      if (this._controller) {
        this._controller.destroy();
        this._controller = null;
      }
      this._phaseTracker = null;
      this._stateMachine = null;
      this._minimizedPillHost = null;
      if (this._onSessionExpired) {
        this.removeEventListener(SessionEvent.ERROR, this._onSessionExpired);
        this._onSessionExpired = null;
      }
      if (this._onSendFailed) {
        this.removeEventListener(SessionEvent.ERROR, this._onSendFailed);
        this._onSendFailed = null;
      }
      if (this._onMessageReceived) {
        this.removeEventListener(SessionEvent.MESSAGE_RECEIVED, this._onMessageReceived);
        this._onMessageReceived = null;
      }
      while (this._shadowRoot.firstChild) {
        this._shadowRoot.removeChild(this._shadowRoot.firstChild);
      }
    }
  }
  const CARET_UP_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 7.5L6 4.5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function escapeAttr(s) {
    return s.replace(/[&<>"']/g, (c) => {
      var _a;
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return (_a = map[c]) != null ? _a : c;
    });
  }
  if (!customElements.get("saga-widget")) {
    customElements.define("saga-widget", SagaWidgetElement);
  }
  const VERSION = "0.1.0";
  exports.VERSION = VERSION;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
//# sourceMappingURL=index.iife.js.map
