import {
  practiceSettingsSchema,
  type PracticeSettings as SavedPracticeSettings,
  type ProblemDifficultyPreference,
  type ReasoningEffort,
} from "@practice-plus-plus/contracts";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";

import type { ThemePreference } from "../../shared/theme";
import { defaultOpenAiModel } from "../../shared/aiSelection";
import { BrowserKeySettings } from "./BrowserKeySettings";
import { OpenAIModelSelect } from "./OpenAIModelSelect";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect";
import { savePracticeSettings } from "./settingsApi";

export type SettingsSection = "practice" | "reviews" | "ai" | "appearance";

const sections: ReadonlyArray<{ value: SettingsSection; label: string }> = [
  { value: "practice", label: "Practice preferences" },
  { value: "reviews", label: "Review intervals" },
  { value: "ai", label: "AI configuration" },
  { value: "appearance", label: "Appearance" },
];

interface SettingsDraft {
  allowPremiumProblems: boolean;
  attemptTimerMinutes: string;
  defaultAiModel: string;
  difficultyPreference: ProblemDifficultyPreference;
  reasoningEffort: ReasoningEffort | "";
  dailyTarget: string;
  highInterval: string;
  lowInterval: string;
  mediumInterval: string;
  resetTime: string;
  timeZone: string;
}

export function PracticeSettings({
  apiUrl,
  token,
  settings,
  visible,
  section,
  onSectionChange,
  themePreference,
  onThemeChange,
  onSaved,
  onReturn,
  returnLabel,
}: {
  readonly apiUrl: string;
  readonly token: string;
  readonly settings: SavedPracticeSettings | null;
  readonly visible: boolean;
  readonly section: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly themePreference: ThemePreference;
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly onSaved: (settings: SavedPracticeSettings) => void;
  readonly onReturn?: () => void;
  readonly returnLabel?: string;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const onboarding = settings === null;

  useEffect(() => {
    if (visible) heading.current?.focus();
  }, [visible, step, section]);

  useEffect(() => {
    if (error && visible) errorElement.current?.focus();
  }, [error, visible]);

  function selectSection(value: SettingsSection) {
    setError(undefined);
    setSaved(false);
    onSectionChange(value);
  }

  function validate(nextStep?: number) {
    const result = practiceSettingsSchema.safeParse({
      defaultAiModel: draft.defaultAiModel,
      reasoningEffort: draft.reasoningEffort || null,
      attemptTimerMinutes: Number(draft.attemptTimerMinutes),
      allowPremiumProblems: draft.allowPremiumProblems,
      difficultyPreference: draft.difficultyPreference,
      dailyTarget: Number(draft.dailyTarget),
      redoIntervals: {
        high: Number(draft.highInterval),
        medium: Number(draft.mediumInterval),
        low: Number(draft.lowInterval),
      },
      resetTime: draft.resetTime,
      timeZone: draft.timeZone,
    });
    if (!result.success) {
      const issue = result.error.issues.find(
        (issue) =>
          nextStep !== 1 ||
          ["timeZone", "resetTime", "dailyTarget"].includes(String(issue.path[0])),
      );
      if (issue) {
        const field = String(issue.path[0]);
        const targetSection: SettingsSection =
          field === "redoIntervals"
            ? "reviews"
            : ["defaultAiModel", "reasoningEffort"].includes(field)
              ? "ai"
              : "practice";
        if (onboarding)
          setStep(
            targetSection === "practice" && ["timeZone", "resetTime", "dailyTarget"].includes(field)
              ? 0
              : targetSection === "ai"
                ? 2
                : 1,
          );
        else onSectionChange(targetSection);
        setError(
          field === "dailyTarget"
            ? "Choose a whole-number daily target from 1 to 20."
            : field === "timeZone"
              ? "Choose a valid timezone."
              : field === "resetTime"
                ? "Choose a valid practice-day reset time."
                : field === "attemptTimerMinutes"
                  ? "Choose a whole-number timer from 1 to 180 minutes."
                  : field === "redoIntervals"
                    ? onboarding
                      ? "Use whole-number review intervals from 1 to 90, with High ≤ Medium ≤ Low."
                      : "Use whole-number review intervals from 1 to 90, with Soonest ≤ Standard ≤ Later."
                    : "Check your AI model and reasoning settings.",
        );
        return null;
      }
    }
    return result;
  }

  function changeStep(value: number) {
    setError(undefined);
    if (value > step && validate(value) === null) return;
    setStep(value);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSaved(false);
    if (onboarding && step < 2) {
      changeStep(step + 1);
      return;
    }
    const result = validate();
    if (!result?.success) return;
    setSaving(true);
    try {
      const next = await savePracticeSettings(apiUrl, token, result.data);
      setDraft(toDraft(next));
      setSaved(true);
      onSaved(next);
    } catch (reason) {
      setError(
        reason instanceof Error && !(reason instanceof TypeError)
          ? reason.message
          : "Your settings could not be saved. Your changes are still here. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const appearanceControls = (
    <fieldset className="appearance-setting">
      <legend className={onboarding ? undefined : "visually-hidden"}>Appearance</legend>
      <div className="appearance-options">
        {(
          [
            ["system", "System default"],
            ["light", "Light"],
            ["dark", "Dark"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={themePreference === value}
              disabled={saving}
              onChange={() => onThemeChange(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const modelControls = (
    <div className="ai-control-grid">
      <OpenAIModelSelect
        value={draft.defaultAiModel}
        disabled={saving}
        onChange={(defaultAiModel) => setDraft((current) => ({ ...current, defaultAiModel }))}
        label={onboarding ? "OpenAI model" : "Default OpenAI model"}
        help={onboarding ? "" : "Used when you open Coach or Attempt tutor."}
      />
      <ReasoningEffortSelect
        model={draft.defaultAiModel}
        value={draft.reasoningEffort || null}
        disabled={saving}
        onChange={(reasoningEffort) =>
          setDraft((current) => ({ ...current, reasoningEffort: reasoningEffort ?? "" }))
        }
      />
    </div>
  );
  const timeZoneControl = (
    <label>
      Timezone
      <select
        value={draft.timeZone}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
      >
        {Array.from(new Set(["UTC", draft.timeZone, ...supportedTimeZones]))
          .sort()
          .map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
      </select>
    </label>
  );
  const resetControl = (
    <label>
      Practice day resets at
      <input
        type="time"
        value={draft.resetTime}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, resetTime: event.target.value })}
      />
    </label>
  );
  const targetControl = (
    <label>
      Daily problem target (1-20)
      <input
        type="number"
        min="1"
        max="20"
        step="1"
        value={draft.dailyTarget}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, dailyTarget: event.target.value })}
      />
    </label>
  );
  const dailyControls = (
    <div className="settings-section setup-daily-fields">
      {onboarding ? (
        <>
          {timeZoneControl}
          {resetControl}
          {targetControl}
        </>
      ) : (
        <>
          {targetControl}
          {timeZoneControl}
          {resetControl}
        </>
      )}
    </div>
  );
  const preferenceControls = (
    <div className="settings-section">
      <label>
        Automatic problem difficulty
        <select
          value={draft.difficultyPreference}
          disabled={saving}
          onChange={(event) =>
            setDraft({
              ...draft,
              difficultyPreference: event.target.value as ProblemDifficultyPreference,
            })
          }
        >
          <option value="ANY">Adaptive</option>
          <option value="EASIER">Easier</option>
          <option value="MEDIUM_ONLY">Medium only</option>
        </select>
        {!onboarding ? (
          <span className="settings-help">
            Easier excludes Hard problems and lets AI include approachable Medium problems. Medium
            only limits new selections to Medium.
          </span>
        ) : null}
      </label>
      <label>
        Default attempt timer (minutes)
        <input
          type="number"
          min="1"
          max="180"
          step="1"
          value={draft.attemptTimerMinutes}
          disabled={saving}
          onChange={(event) => setDraft({ ...draft, attemptTimerMinutes: event.target.value })}
        />
      </label>
      <label className="premium-setting">
        <input
          type="checkbox"
          checked={draft.allowPremiumProblems}
          disabled={saving}
          onChange={(event) => setDraft({ ...draft, allowPremiumProblems: event.target.checked })}
        />
        <span>
          Allow Premium problems in automatic selections
          {!onboarding ? (
            <span className="settings-help">
              Premium problems remain visible in Problems even when this is off.
            </span>
          ) : null}
        </span>
      </label>
    </div>
  );
  const intervalControls = (
    <fieldset>
      <legend>
        {onboarding ? "Redo intervals (days)" : "Days until the next exact-problem review"}
      </legend>
      <div className="interval-grid">
        {(
          [
            ["highInterval", onboarding ? "High" : "Soonest"],
            ["mediumInterval", onboarding ? "Medium" : "Standard"],
            ["lowInterval", onboarding ? "Low" : "Later"],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            {label}
            <input
              type="number"
              min="1"
              max="90"
              step="1"
              value={draft[field]}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="settings-help">
        {onboarding
          ? "Choose 1 to 90 days, with High ≤ Medium ≤ Low."
          : "Use whole numbers from 1 to 90 in increasing order. Equal intervals are allowed."}
      </p>
    </fieldset>
  );
  const feedback = (
    <>
      {error ? (
        <p ref={errorElement} tabIndex={-1} className="auth-message" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !onboarding ? (
        <p className="save-message" role="status">
          Settings saved.
        </p>
      ) : null}
    </>
  );

  if (onboarding)
    return (
      <section className="onboarding" hidden={!visible} aria-busy={saving}>
        <header className="setup-heading">
          <h2 ref={heading} tabIndex={-1}>
            Set up your practice
          </h2>
          <p className="settings-help setup-intro">A few preferences to shape your daily plan.</p>
        </header>
        <nav className="setup-steps" aria-label="Setup steps">
          {["Daily practice", "Preferences", "AI setup"].map((label, index) => (
            <Fragment key={label}>
              {index > 0 ? <span className="setup-step-connector" aria-hidden="true" /> : null}
              <button
                type="button"
                className="setup-step"
                aria-current={step === index ? "step" : undefined}
                disabled={saving}
                onClick={() => changeStep(index)}
              >
                <span aria-hidden="true">{index + 1}</span>
                {label}
              </button>
            </Fragment>
          ))}
        </nav>
        <form
          id="practice-settings"
          className="settings-form settings-page page-surface"
          hidden={step === 2}
          noValidate
          onSubmit={(event) => void save(event)}
        >
          {step === 0 ? (
            <>
              <h3>Daily practice</h3>
              <p className="settings-help">
                Choose when your practice day begins and how much to take on.
              </p>
              {dailyControls}
              <p className="settings-notice">
                Your day starts at {draft.resetTime} in {draft.timeZone}. Aim for{" "}
                {draft.dailyTarget} problems a day.
              </p>
            </>
          ) : (
            <>
              <h3>Practice preferences</h3>
              <p className="settings-help">
                Start with these defaults or adjust them to fit your practice.
              </p>
              {preferenceControls}
              {intervalControls}
              {appearanceControls}
              <p className="settings-notice">
                These preferences guide future plans and follow-ups. Existing review dates stay
                unchanged.
              </p>
            </>
          )}
          {step !== 2 ? feedback : null}
        </form>
        {step === 2 ? (
          <section className="setup-ai page-surface" aria-labelledby="setup-ai-heading">
            <h3 id="setup-ai-heading">
              AI setup <span>Optional</span>
            </h3>
            <p className="settings-help">
              Add AI when you’re ready. You can also set it up later in Settings.
            </p>
            <p className="settings-notice">
              Without AI, you can still generate a plan, practice, and record results. External-AI
              tools remain available.
            </p>
            <BrowserKeySettings embedded disabled={saving} />
            <div className="settings-form setup-models">{modelControls}</div>
            {feedback}
          </section>
        ) : null}
        <div className="setup-actions">
          {step > 0 ? (
            <button
              type="button"
              className="secondary-button setup-back"
              disabled={saving}
              onClick={() => changeStep(step - 1)}
            >
              Back
            </button>
          ) : null}
          {step === 2 ? (
            <button
              type="submit"
              form="practice-settings"
              className="secondary-button setup-skip"
              disabled={saving}
            >
              Continue without AI
            </button>
          ) : null}
          <button
            type="submit"
            form="practice-settings"
            className="setup-primary"
            disabled={saving}
          >
            {saving ? "Saving…" : step < 2 ? "Continue" : "Start practicing"}
          </button>
        </div>
      </section>
    );

  const title = sections.find((item) => item.value === section)!.label;
  return (
    <section className="settings-page-wrapper" hidden={!visible} aria-busy={saving}>
      <header className="settings-page-heading">
        <div>
          <h2>Settings</h2>
          <p className="settings-help">Practice preferences and your AI connection.</p>
        </div>
        {onReturn ? (
          <button type="button" className="settings-return" onClick={onReturn}>
            {returnLabel}
          </button>
        ) : null}
      </header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings sections">
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-current={section === item.value ? "page" : undefined}
              disabled={saving}
              onClick={() => selectSection(item.value)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-section-content">
          <label className="settings-mobile-section">
            Settings section
            <select
              value={section}
              disabled={saving}
              onChange={(event) => selectSection(event.target.value as SettingsSection)}
            >
              {sections.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <section
            className="settings-panel page-surface"
            data-section={section}
            aria-labelledby="settings-section-heading"
          >
            <h3 id="settings-section-heading" ref={heading} tabIndex={-1}>
              {title}
            </h3>
            {section === "ai" ? (
              <>
                <p className="settings-help">Use your OpenAI account for in-app AI features.</p>
                <BrowserKeySettings embedded disabled={saving} />
                <p className="settings-help">Key and storage changes take effect immediately.</p>
              </>
            ) : null}
            {["practice", "reviews", "ai"].includes(section) ? (
              <form
                id="practice-settings"
                className="settings-form"
                noValidate
                onSubmit={(event) => void save(event)}
              >
                {section === "practice" ? (
                  <>
                    {dailyControls}
                    <hr />
                    {preferenceControls}
                    <p className="settings-notice">
                      Changes apply to the next generated plan. Your saved plan and active attempt
                      stay in place.
                    </p>
                  </>
                ) : section === "reviews" ? (
                  <>
                    {intervalControls}
                    <p className="settings-notice">
                      Applies to future follow-ups. Existing review dates and manual overrides stay
                      unchanged.
                    </p>
                  </>
                ) : (
                  <>
                    {modelControls}
                    <p className="settings-notice">
                      Planning, practice, and result recording remain available without AI.
                    </p>
                  </>
                )}
                {feedback}
                <div className="settings-save-actions">
                  <button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save settings"}
                  </button>
                </div>
              </form>
            ) : null}
            {section === "appearance" ? (
              <>
                <p className="settings-help">Choose how Practice++ looks in this browser.</p>
                {appearanceControls}
                <p className="settings-help">Applies immediately.</p>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}

function toDraft(settings: SavedPracticeSettings | null): SettingsDraft {
  return {
    allowPremiumProblems: settings?.allowPremiumProblems ?? true,
    defaultAiModel: settings?.defaultAiModel ?? defaultOpenAiModel,
    difficultyPreference: settings?.difficultyPreference ?? "ANY",
    reasoningEffort: settings?.reasoningEffort ?? "",
    attemptTimerMinutes: String(settings?.attemptTimerMinutes ?? 30),
    dailyTarget: String(settings?.dailyTarget ?? 2),
    highInterval: String(settings?.redoIntervals.high ?? 1),
    lowInterval: String(settings?.redoIntervals.low ?? 7),
    mediumInterval: String(settings?.redoIntervals.medium ?? 3),
    resetTime: settings?.resetTime ?? "04:00",
    timeZone: settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}

const supportedTimeZones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();
