"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ───

interface Choice {
  label: string;
  description: string;
  risk: string;
  riskConfidence?: number;
  archetype?: string;
}

interface GameState {
  situation: string;
  health: number;
  maxHealth: number;
  inventory: string[];
  turnNumber: number;
  chaos: number;
  location: string;
  objective: string;
  storyFlags: string[];
  jevDecisions: number;
  totalCost: number;
}

interface TurnResult {
  successProb: number;
  grade: string;
  consequence: string;
  consequenceConfidence: number;
  consequenceProbabilities: Record<string, number>;
  danger: string;
  dangerConfidence: number;
  diceRoll: number;
  healthDelta: number;
  chaosDelta: number;
  narration: string;
  nextSituation: string;
  location: string;
  choices: Choice[];
  rejectedCandidates: Array<{ label: string; description: string; score: number }>;
  inventoryAdd: string[];
  inventoryRemove: string[];
  objective: string;
  storyFlag: string | null;
  runStatus: string;
  jevCost: number;
  jevDecisions: number;
}

type Phase = "choosing" | "rolling" | "result";

// ─── Constants ───

const OPENING: GameState = {
  situation:
    "You stand at the entrance of an old stone tunnel. A soft blue light glows deep inside. The air smells like wet mud and old metal. A rusty iron lantern sits on the ground near your feet.",
  health: 3,
  maxHealth: 3,
  inventory: ["rope", "flint & steel", "stale bread"],
  turnNumber: 0,
  chaos: 0,
  location: "Cave Entrance",
  objective: "Explore the tunnel and find out what is inside",
  storyFlags: [],
  jevDecisions: 0,
  totalCost: 0,
};

const INITIAL_CHOICES: Choice[] = [
  {
    label: "Light the lantern",
    description: "Use your flint & steel to light the rusty lantern on the ground",
    risk: "safe",
  },
  {
    label: "Walk into the dark tunnel",
    description: "Go in without light — you cannot see, but you move fast",
    risk: "risky",
  },
  {
    label: "Touch the glowing symbol",
    description: "A soft blue shape glows on the cave wall near the entrance",
    risk: "dangerous",
  },
];

const RISK_STYLE: Record<string, { dot: string; border: string; label: string }> = {
  safe: { dot: "#33cc77", border: "#1a3a2a", label: "Safe" },
  risky: { dot: "#ccaa33", border: "#3a3a1a", label: "Risky" },
  dangerous: { dot: "#cc3355", border: "#3a1a2a", label: "Dangerous" },
};

const GRADE_STYLE: Record<string, { color: string; icon: string; label: string; border: string }> = {
  CRITICAL_SUCCESS: { color: "#22ee88", icon: "★", label: "CRITICAL SUCCESS", border: "#1a4a2a" },
  SUCCESS:          { color: "#33cc77", icon: "✓", label: "SUCCESS",          border: "#1a3a2a" },
  PARTIAL:          { color: "#ccaa33", icon: "~", label: "PARTIAL",          border: "#3a3a1a" },
  FAIL:             { color: "#cc3355", icon: "✗", label: "FAIL",             border: "#3a1a1a" },
  CRITICAL_FAIL:    { color: "#ff2244", icon: "☠", label: "CRITICAL FAIL",    border: "#4a1a1a" },
};

const CONSEQUENCE_LABELS: Record<string, { icon: string; label: string }> = {
  find_item: { icon: "🔑", label: "Item Discovered" },
  trigger_trap: { icon: "⚡", label: "Trap Triggered" },
  reveal_passage: { icon: "🚪", label: "Path Revealed" },
  wake_enemy: { icon: "👹", label: "Enemy Awakened" },
  gain_clue: { icon: "📜", label: "Clue Found" },
  nothing_notable: { icon: "—", label: "Nothing Notable" },
  meet_npc: { icon: "👤", label: "Encounter" },
};

// ─── Main component ───

export default function JevAdventureGame() {
  const [started, setStarted] = useState(false);
  const [game, setGame] = useState<GameState>(OPENING);
  const [choices, setChoices] = useState<Choice[]>(INITIAL_CHOICES);
  const [phase, setPhase] = useState<Phase>("choosing");
  const [lastResult, setLastResult] = useState<TurnResult | null>(null);
  const [showJevRead, setShowJevRead] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [diceDisplay, setDiceDisplay] = useState(0);
  const [victory, setVictory] = useState(false);
  const [simpleEnglish, setSimpleEnglish] = useState(true);

  const customInputRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  const playTurn = useCallback(
    async (action: string) => {
      if (phase !== "choosing" || !action.trim()) return;

      setPhase("rolling");
      setError(null);
      setDiceDisplay(0);

      // Start dice animation
      let delay = 40;
      let animDone = false;
      function tick() {
        if (animDone) return;
        setDiceDisplay(Math.floor(Math.random() * 20) + 1);
        delay += 12;
        if (delay < 200) {
          setTimeout(tick, delay);
        }
      }
      tick();

      try {
        const [res] = await Promise.all([
          fetch("/api/turn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: action.trim(),
              situation: game.situation,
              health: game.health,
              maxHealth: game.maxHealth,
              inventory: game.inventory,
              turnNumber: game.turnNumber + 1,
              chaos: game.chaos,
              location: game.location,
              objective: game.objective,
              storyFlags: game.storyFlags,
              simpleEnglish,
            }),
          }),
          new Promise((r) => setTimeout(r, 2000)),
        ]);

        animDone = true;

        if (!res.ok) {
          const data = await res
            .json()
            .catch(() => ({ error: "Request failed" }));
          throw new Error(data.error || `Error ${res.status}`);
        }

        const data: TurnResult = await res.json();

        // Land the dice on the real number
        setDiceDisplay(data.diceRoll);
        await new Promise((r) => setTimeout(r, 400));

        // Update game state
        const newHealth = Math.max(0, game.health + data.healthDelta);
        const newChaos = Math.max(
          0,
          Math.min(10, game.chaos + data.chaosDelta)
        );
        const newInventory = [
          ...game.inventory,
          ...(data.inventoryAdd ?? []),
        ].filter((item) => !(data.inventoryRemove ?? []).includes(item));
        const newFlags = [...game.storyFlags];
        if (data.storyFlag) newFlags.push(data.storyFlag);

        setGame({
          situation: data.nextSituation,
          health: newHealth,
          maxHealth: game.maxHealth,
          inventory: newInventory,
          turnNumber: game.turnNumber + 1,
          chaos: newChaos,
          location: data.location || game.location,
          objective: data.objective || game.objective,
          storyFlags: newFlags,
          jevDecisions: game.jevDecisions + data.jevDecisions,
          totalCost: game.totalCost + data.jevCost,
        });

        setLastResult(data);
        setChoices(data.choices);
        setPhase("result");
        setCustomInput("");

        if (newHealth <= 0 || data.runStatus === "failed") {
          setGameOver(true);
        } else if (data.runStatus === "solved") {
          setVictory(true);
          setGameOver(true);
        }

        // Auto-transition to choosing after a brief pause
        setTimeout(() => {
          if (newHealth > 0 && data.runStatus !== "solved" && data.runStatus !== "failed") {
            setPhase("choosing");
            sceneRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }, 300);
      } catch (err) {
        animDone = true;
        setPhase("choosing");
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [phase, game, simpleEnglish]
  );

  const restart = () => {
    setGame(OPENING);
    setChoices(INITIAL_CHOICES);
    setPhase("choosing");
    setLastResult(null);
    setError(null);
    setCustomInput("");
    setGameOver(false);
    setVictory(false);
    setDiceDisplay(0);
  };

  // ─── Title screen ───
  if (!started) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-[#c8c8d0] flex flex-col items-center justify-center px-4">
        <div className="max-w-[480px] w-full text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-widest text-[#e0e0e8] mb-2">
            GEV ADVENTURE
          </h1>
          <p className="text-sm text-[#555570] mb-8 tracking-wide">
            hidden dice &middot; real decisions &middot; typed consequences
          </p>

          <div className="text-left space-y-4 mb-8 text-sm leading-relaxed text-[#8888a0]">
            <p>
              An AI named <span className="text-[#b0b0cc]">Gev</span> controls
              every outcome in this adventure. Gev is a{" "}
              <span className="text-[#b0b0cc]">decision model</span> — not a
              storyteller. It evaluates your action, picks the consequence from
              a typed menu, and rates every choice you see for risk.
            </p>
            <p>
              Each turn, Gev makes{" "}
              <span className="text-[#b0b0cc]">13+ real decisions</span>:
              success probability, consequence type, danger level, plus it
              selects which choices you see from a larger pool and rates
              their risk. A narrator describes what happened — but cannot
              overrule Gev.
            </p>
            <p>
              You start with <span className="text-[#cc3355]">3 HP</span> and
              a chaos meter at zero. Reckless failures raise chaos — and Gev
              reads that too.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {["safe", "risky", "dangerous"].map((r) => {
              const s = RISK_STYLE[r];
              return (
                <span
                  key={r}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs"
                  style={{
                    borderColor: s.border,
                    color: s.dot,
                    backgroundColor: "#0f0f1a",
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: s.dot }}
                  />
                  {s.label}
                </span>
              );
            })}
          </div>

          <button
            onClick={() => setStarted(true)}
            className="px-8 py-3 bg-[#1a1a2e] border border-[#2a2a4e] rounded-lg text-sm text-[#c0c0d0] hover:bg-[#22223a] hover:text-[#e0e0e8] hover:border-[#3a3a5e] transition-colors cursor-pointer tracking-wide"
          >
            Begin adventure
          </button>

          <p className="mt-8 text-[10px] text-[#333350]">
            Every outcome is a real Gev decision. Built on @typesafeai via
            OpenRouter.
          </p>
        </div>
      </div>
    );
  }

  // ─── Game over screen ───
  if (gameOver && lastResult) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-[#c8c8d0] flex flex-col items-center justify-center px-4">
        <GameOverCard game={game} result={lastResult} onRestart={restart} victory={victory} />
      </div>
    );
  }

  // ─── Game screen ───
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#c8c8d0] flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-[480px] px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#555570]">
                {game.location}
              </span>
              <span className="text-[10px] text-[#333350]">
                T{game.turnNumber}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSimpleEnglish((v) => !v)}
              className="text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer"
              style={{
                borderColor: simpleEnglish ? "#1a3a2a" : "#1a1a2e",
                color: simpleEnglish ? "#33cc77" : "#444460",
                backgroundColor: simpleEnglish ? "#0f1a14" : "transparent",
              }}
              title="Simple English — easier to read for everyone"
            >
              {simpleEnglish ? "Simple" : "Normal"}
            </button>
            <button
              onClick={() => setShowJevRead((v) => !v)}
              className="text-xs px-2 py-1 rounded border transition-colors cursor-pointer"
              style={{
                borderColor: showJevRead ? "#3a3a5e" : "#1a1a2e",
                color: showJevRead ? "#b0b0cc" : "#444460",
                backgroundColor: showJevRead ? "#1a1a2e" : "transparent",
              }}
              title="Toggle Gev's read — see raw decisions and confidence"
            >
              {showJevRead ? "Gev ON" : "Gev"}
            </button>
            <Health current={game.health} max={game.maxHealth} />
          </div>
        </div>

        {/* Chaos meter */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-[#444460] w-10">Chaos</span>
          <div className="flex-1 h-1.5 bg-[#12121f] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(game.chaos / 10) * 100}%`,
                backgroundColor:
                  game.chaos <= 3
                    ? "#3366cc"
                    : game.chaos <= 6
                      ? "#ccaa33"
                      : "#cc3355",
              }}
            />
          </div>
          <span className="text-[10px] text-[#444460] tabular-nums w-6 text-right">
            {game.chaos}
          </span>
        </div>

        {/* Objective */}
        {game.objective && (
          <div className="text-[10px] text-[#444460] mb-1">
            {game.objective}
          </div>
        )}
      </header>

      <div className="w-full max-w-[480px] border-t border-[#1a1a2e]" />

      {/* Main scene area */}
      <main
        ref={sceneRef}
        className="flex-1 w-full max-w-[480px] px-4 py-4 overflow-y-auto"
      >
        {/* Dice rolling animation */}
        {phase === "rolling" && (
          <div className="flex flex-col items-center justify-center py-12 animate-fadeIn">
            <div
              className="w-20 h-20 rounded-xl border-2 border-[#2a2a4e] bg-[#12121f] flex items-center justify-center mb-4"
              style={{
                boxShadow: "0 0 30px rgba(100, 100, 200, 0.1)",
              }}
            >
              <span className="text-3xl font-bold text-[#e0e0e8] tabular-nums animate-pulse">
                {diceDisplay || "?"}
              </span>
            </div>
            <span className="text-xs text-[#555570] animate-pulse">
              Gev is reading the situation...
            </span>
          </div>
        )}

        {/* Turn result */}
        {phase !== "rolling" && lastResult && (
          <div className="mb-6 animate-fadeIn">
            {/* Dice result */}
            {(() => {
              const gs = GRADE_STYLE[lastResult.grade] ?? GRADE_STYLE.FAIL;
              return (
                <div className="flex flex-col items-center mb-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg" style={{ color: gs.color }}>
                      {gs.icon}
                    </span>
                    <div
                      className="w-12 h-12 rounded-lg border-2 flex items-center justify-center"
                      style={{
                        borderColor: gs.color,
                        backgroundColor: "#0f0f1a",
                      }}
                    >
                      <span className="text-xl font-bold text-[#e0e0e8] tabular-nums">
                        {lastResult.diceRoll}
                      </span>
                    </div>
                  </div>

                  {/* Grade + consequence badges */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-bold"
                      style={{
                        color: gs.color,
                        borderColor: gs.border,
                        backgroundColor: "#0f0f1a",
                      }}
                    >
                      {gs.label}
                    </span>

                    {lastResult.consequence !== "nothing_notable" && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#1a1a2e] bg-[#0f0f1a] text-xs text-[#8888a0]">
                        {CONSEQUENCE_LABELS[lastResult.consequence]?.icon}{" "}
                        {CONSEQUENCE_LABELS[lastResult.consequence]?.label ??
                          lastResult.consequence}
                      </span>
                    )}

                    {lastResult.healthDelta < 0 && (
                      <span className="text-xs text-[#cc3355]">
                        {lastResult.healthDelta} HP
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Jev's read panel */}
            {showJevRead && (
              <div className="mb-4 p-3 rounded border border-[#1a1a2e] bg-[#0a0a14] text-[10px] text-[#555570] space-y-1 animate-fadeIn">
                <div className="text-[#666680] font-bold mb-1">
                  Gev&apos;s Read
                </div>
                <div>
                  Gev: p(success) ={" "}
                  {lastResult.successProb.toFixed(2)} →{" "}
                  graded{" "}
                  <span
                    style={{
                      color:
                        GRADE_STYLE[lastResult.grade]?.color ?? "#9090a0",
                    }}
                  >
                    {lastResult.grade}
                  </span>
                </div>
                <div className="mt-1">
                  Consequence: {lastResult.consequence} (
                  {Math.round(lastResult.consequenceConfidence * 100)}%)
                </div>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(lastResult.consequenceProbabilities)
                    .sort(
                      ([, a], [, b]) => (b as number) - (a as number)
                    )
                    .slice(0, 4)
                    .map(([k, v]) => (
                      <span key={k}>
                        {k}: {Math.round((v as number) * 100)}%
                      </span>
                    ))}
                </div>
                <div className="mt-1">
                  Danger: {lastResult.danger} (
                  {Math.round(lastResult.dangerConfidence * 100)}%)
                </div>
                {lastResult.rejectedCandidates?.length > 0 && (
                  <div className="mt-2 pt-1 border-t border-[#1a1a2e]">
                    <div className="text-[#555570] mb-0.5">
                      Gev selected from{" "}
                      {(lastResult.choices?.length ?? 0) +
                        (lastResult.rejectedCandidates?.length ?? 0)}{" "}
                      candidates:
                    </div>
                    {lastResult.choices?.map((c, i) => (
                      <div key={`sel-${i}`} className="text-[#33cc77]">
                        &#10003; {c.label} ({c.archetype})
                      </div>
                    ))}
                    {lastResult.rejectedCandidates.map((c, i) => (
                      <div key={`rej-${i}`} className="text-[#444460]">
                        &#10007; {c.label} —{" "}
                        {Math.round(c.score * 100)}%
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Narration */}
            <div className="text-sm leading-relaxed text-[#b0b0c0] mb-4 animate-fadeIn">
              {lastResult.narration}
            </div>

            {/* Inventory changes */}
            {lastResult.inventoryAdd?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {lastResult.inventoryAdd.map((item) => (
                  <span
                    key={item}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-[#1a3a2a] bg-[#0f0f1a] text-[#33cc77]"
                  >
                    + {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Current situation */}
        {phase !== "rolling" && (
          <div className="mb-5 text-sm leading-relaxed text-[#9090a0]">
            {game.situation}
          </div>
        )}

        {/* Choice cards */}
        {phase !== "rolling" && !gameOver && (
          <div className="space-y-2.5 mb-5 animate-slideUp">
            {choices.map((choice, i) => {
              const rs = RISK_STYLE[choice.risk] ?? RISK_STYLE.risky;
              return (
                <button
                  key={`${choice.label}-${i}`}
                  onClick={() => playTurn(choice.label)}
                  className="w-full text-left p-3 rounded-lg border transition-all duration-200 cursor-pointer group"
                  style={{
                    borderColor: rs.border,
                    backgroundColor: "#0f0f1a",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      "#141422";
                    (e.currentTarget as HTMLElement).style.borderColor =
                      rs.dot;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      "#0f0f1a";
                    (e.currentTarget as HTMLElement).style.borderColor =
                      rs.border;
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm text-[#c8c8d0] group-hover:text-[#e0e0e8] transition-colors">
                        {choice.label}
                      </div>
                      <div className="text-xs text-[#555570] mt-0.5">
                        {choice.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: rs.dot }}
                      />
                      <span
                        className="text-[10px]"
                        style={{ color: rs.dot }}
                      >
                        {rs.label}
                      </span>
                      {showJevRead && choice.riskConfidence != null && (
                        <span className="text-[10px] text-[#444460] tabular-nums">
                          {Math.round(choice.riskConfidence * 100)}%
                          {choice.archetype && ` · ${choice.archetype}`}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom action input */}
        {phase !== "rolling" && !gameOver && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customInput.trim()) playTurn(customInput.trim());
            }}
            className="flex gap-2 mb-4"
          >
            <input
              ref={customInputRef}
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Or type your own action..."
              className="flex-1 bg-[#0f0f1a] border border-[#1a1a2e] rounded px-3 py-2 text-xs text-[#c8c8d0] placeholder:text-[#2a2a40] focus:outline-none focus:border-[#2a2a4e] transition-colors"
            />
            <button
              type="submit"
              disabled={!customInput.trim()}
              className="px-3 py-2 bg-[#1a1a2e] border border-[#2a2a4e] rounded text-xs text-[#666680] hover:text-[#9090a0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Go
            </button>
          </form>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-[#1a0a0a] border border-[#3a1515] rounded text-xs text-[#cc4444] mb-4">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 underline text-[#884444] hover:text-[#cc4444] cursor-pointer"
            >
              dismiss
            </button>
          </div>
        )}
      </main>

      {/* Inventory bar */}
      <footer className="w-full max-w-[480px] px-4 py-3 border-t border-[#1a1a2e]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-[#333350]">Inventory</span>
          {game.inventory.length === 0 ? (
            <span className="text-[10px] text-[#222235]">empty</span>
          ) : (
            game.inventory.map((item) => (
              <span
                key={item}
                className="text-[10px] px-1.5 py-0.5 bg-[#12121f] border border-[#1a1a2e] rounded text-[#666680]"
              >
                {item}
              </span>
            ))
          )}
        </div>
        <p className="mt-2 text-[10px] text-[#222235]">
          {game.jevDecisions} Gev decisions
          {game.totalCost > 0 &&
            ` · $${game.totalCost.toFixed(4)}`}
        </p>
      </footer>
    </div>
  );
}

// ─── Sub-components ───

function Health({ current, max }: { current: number; max: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className="text-sm transition-colors duration-300"
          style={{ color: i < current ? "#cc3355" : "#2a2a3e" }}
        >
          &#9829;
        </span>
      ))}
    </div>
  );
}

function GameOverCard({
  game,
  result,
  onRestart,
  victory,
}: {
  game: GameState;
  result: TurnResult;
  onRestart: () => void;
  victory: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const shareText = victory
    ? `I beat Gev Adventure in ${game.turnNumber} turns — ${game.jevDecisions} real Gev decisions, $${game.totalCost.toFixed(4)} spent. Every outcome decided live by @typesafeai.`
    : `I survived ${game.turnNumber} turn${game.turnNumber !== 1 ? "s" : ""} in Gev Adventure — ${game.jevDecisions} real Gev decisions, $${game.totalCost.toFixed(4)} spent. Every outcome decided live by @typesafeai.`;

  const handleShare = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="max-w-[400px] w-full p-8 rounded-xl border bg-[#0f0a1a] text-center"
      style={{ borderColor: victory ? "#1a4a2a" : "#2a1540" }}
    >
      <div className="text-[10px] tracking-widest text-[#444460] mb-4">
        GEV ADVENTURE
      </div>

      <div
        className="text-2xl font-bold mb-6 tracking-wider"
        style={{ color: victory ? "#22ee88" : "#aa3355" }}
      >
        {victory ? "VICTORY" : "GAME OVER"}
      </div>

      <div className="text-sm text-[#b0b0c0] mb-2">{result.narration}</div>

      <div className="my-6 space-y-2 text-sm text-[#8888a0]">
        <div>
          <span className="text-[#e0e0e8] font-bold tabular-nums">
            {game.turnNumber}
          </span>{" "}
          {victory ? "turns to victory" : "turns survived"}
        </div>
        <div>
          <span className="text-[#e0e0e8] font-bold tabular-nums">
            {game.jevDecisions}
          </span>{" "}
          real Gev decisions
        </div>
        <div>
          <span className="text-[#e0e0e8] font-bold tabular-nums">
            {game.chaos}
          </span>{" "}
          final chaos level
        </div>
        {game.totalCost > 0 && (
          <div>
            <span className="text-[#e0e0e8] font-bold tabular-nums">
              ${game.totalCost.toFixed(4)}
            </span>{" "}
            total API cost
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-center">
        <button
          onClick={onRestart}
          className="px-5 py-2.5 bg-[#1a1a2e] border border-[#2a2a4e] rounded-lg text-xs text-[#9090a0] hover:bg-[#22223a] hover:text-[#c0c0d0] transition-colors cursor-pointer"
        >
          Play again
        </button>
        <button
          onClick={handleShare}
          className="px-5 py-2.5 bg-[#1a1a2e] border border-[#2a2a4e] rounded-lg text-xs text-[#9090a0] hover:bg-[#22223a] hover:text-[#c0c0d0] transition-colors cursor-pointer"
        >
          {copied ? "Copied!" : "Share result"}
        </button>
      </div>

      <p className="mt-6 text-[10px] text-[#333350]">
        Every outcome was a real Gev decision. @typesafeai via OpenRouter.
      </p>
    </div>
  );
}
