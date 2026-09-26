import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const JEV_MODEL = "~typesafe/jev-latest";
const NARRATOR_MODEL = "openai/gpt-4o-mini";

interface TurnRequest {
  action: string;
  situation: string;
  health: number;
  maxHealth: number;
  inventory: string[];
  turnNumber: number;
  chaos: number;
  location: string;
  objective: string;
  storyFlags: string[];
  simpleEnglish?: boolean;
}

interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevNoulAnswer {
  noul: number;
}

type Grade =
  | "CRITICAL_SUCCESS"
  | "SUCCESS"
  | "PARTIAL"
  | "FAIL"
  | "CRITICAL_FAIL";

function gradeFromP(p: number): Grade {
  if (p >= 0.8) return "CRITICAL_SUCCESS";
  if (p >= 0.55) return "SUCCESS";
  if (p >= 0.35) return "PARTIAL";
  if (p >= 0.2) return "FAIL";
  return "CRITICAL_FAIL";
}

async function fetchRetry(
  url: string,
  options: RequestInit,
  retries = 1
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || i === retries) return res;
    } catch (err) {
      if (i === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("unreachable");
}

// ─── Call 1: Jev outcome — Noul success + Choice consequence + Choice danger ───
async function callJevOutcome(req: TurnRequest) {
  const stateBlock = [
    `Location: ${req.location}`,
    `Situation: ${req.situation}`,
    `Player health: ${req.health}/${req.maxHealth}. Chaos level: ${req.chaos}/10.`,
    `Inventory: ${req.inventory.length > 0 ? req.inventory.join(", ") : "nothing"}.`,
    req.storyFlags.length > 0
      ? `Past events: ${req.storyFlags.slice(-5).join("; ")}.`
      : "",
    `Turn: ${req.turnNumber}.`,
    `Player action: "${req.action}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetchRetry("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: { context: stateBlock },
      questions: {
        success_chance: {
          type: "noul",
          instructions:
            "Does the player's action succeed? Consider plausibility, inventory, health, chaos level, and past events. Higher chaos makes success less likely. Low health makes risky actions harder.",
          criteria: {
            true: "The action succeeds — works as intended",
            false: "The action fails — does not work or backfires",
          },
        },
        consequence: {
          type: "choice",
          instructions:
            "What significant event results from this action in this environment? Consider the location, past events, chaos, and what creates interesting narrative progression.",
          criteria: {
            find_item:
              "Player discovers a useful item, tool, weapon, or resource",
            trigger_trap:
              "A trap, hazard, or environmental danger activates",
            reveal_passage:
              "A new path, hidden room, or unexplored area becomes accessible",
            wake_enemy:
              "A creature, guardian, or hostile force becomes aware and threatens the player",
            gain_clue:
              "Important information is revealed — a puzzle hint, lore, or warning",
            nothing_notable:
              "No significant world change beyond the immediate action",
            meet_npc:
              "A character, spirit, or sentient being appears or responds",
          },
        },
        danger: {
          type: "choice",
          instructions:
            "How dangerous is the immediate situation for the player right now? Consider the environment, the action, and the chaos level.",
          criteria: {
            safe: "No physical threat to the player",
            risky: "Moderate danger — the player could get hurt",
            deadly:
              "Extreme danger — the player could be gravely injured or killed",
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jev API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<{
    answers: {
      success_chance: JevNoulAnswer;
      consequence: JevChoiceAnswer;
      danger: JevChoiceAnswer;
    };
    usage?: { cost: number };
  }>;
}

// ─── Call 2: Narrator generates story + 6 candidate actions ───
const CONSEQUENCE_DESC: Record<string, string> = {
  find_item: "the player discovers a useful item — name it specifically",
  trigger_trap:
    "a trap or hazard activates — describe it vividly. The player takes extra damage.",
  reveal_passage: "a new area or path becomes accessible",
  wake_enemy:
    "a hostile force becomes active and threatens the player — tension rises",
  gain_clue:
    "important information is revealed — describe the clue specifically",
  nothing_notable: "no significant change beyond the immediate action",
  meet_npc: "a character or sentient being appears or responds",
};

async function callNarrator(
  req: TurnRequest,
  grade: Grade,
  consequence: string,
  danger: string,
  healthDelta: number,
  simpleEnglish: boolean
) {
  const gradeDesc: Record<Grade, string> = {
    CRITICAL_SUCCESS:
      "the action works brilliantly — describe a decisive, impressive success",
    SUCCESS: "the action works cleanly",
    PARTIAL: "mixed result with a complication or cost",
    FAIL: "the action does not work — a setback",
    CRITICAL_FAIL:
      "the action backfires badly — describe a disaster or painful consequence",
  };

  const res = await fetchRetry(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: NARRATOR_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are the game master of a dark fantasy adventure. Second person ("You..."). Concise — 2-3 sentences max.
${simpleEnglish ? `
WRITING STYLE — read carefully:
- Write in simple, clear English that a 12-year-old or a non-native speaker can read easily. This matters more than sounding fancy.
- Use short sentences. One idea per sentence. Aim for 8-14 words per sentence.
- Use common, everyday words. Avoid rare or literary words.
  - Instead of "crumbling stone passage" -> "old stone tunnel that is falling apart"
  - Instead of "the air smells metallic" -> "the air smells like old metal"
  - Instead of "faint blue light pulses" -> "a soft blue light glows on and off"
- Do not use poetic or dramatic phrases just to sound cool. Say what happens plainly.
- Keep the whole story part to 2-3 short sentences. No long paragraphs.
- Never use words most people would need a dictionary for. If a simpler word exists, use it.
` : ""}
MATCH the ruling exactly:
- grade "${grade}": ${gradeDesc[grade]}
- consequence "${consequence}": ${CONSEQUENCE_DESC[consequence] ?? "something unexpected happens"}
- danger "${danger}": ${danger === "deadly" ? "life-threatening" : danger === "risky" ? "tense, hint at danger" : "calm for now"}
${healthDelta < 0 ? `The player took ${Math.abs(healthDelta)} damage — describe the injury briefly.` : ""}

Return JSON:
{
  "narration": "2-3 ${simpleEnglish ? "short, simple" : "vivid"} sentences combining outcome and consequence",
  "nextSituation": "One ${simpleEnglish ? "simple" : ""} sentence: where the player is and what they face now",
  "location": "Short location name (2-4 words)",
  "candidates": [
    {"label": "${simpleEnglish ? "Simple action (2-6 words)" : "Short action (3-6 words)"}", "description": "${simpleEnglish ? "One plain sentence about what might happen" : "One-sentence elaboration"}"},
    {"label": "...", "description": "..."},
    {"label": "...", "description": "..."},
    {"label": "...", "description": "..."},
    {"label": "...", "description": "..."},
    {"label": "...", "description": "..."}
  ],
  "inventoryAdd": ${consequence === "find_item" || grade === "CRITICAL_SUCCESS" ? '["specific item name relevant to a fantasy cave adventure"]' : "[]"},
  "inventoryRemove": ["items consumed, destroyed, or lost during this action"],
  "objective": "Current goal in one sentence"
}

If the player's action consumes, destroys, or loses an inventory item (eating food, breaking a tool, dropping something), include it in inventoryRemove.
${simpleEnglish ? `CHOICE CARDS — keep them short and clear:
- Each candidate is a short action the player can picture. 2-6 words.
  - Good: "Open the stone door", "Look under the table", "Climb the stairs"
  - Bad: "Investigate the curious mechanism", "Venture toward the luminescence"
- The description uses plain words to explain what might happen.
  - "Open the stone door — something may be behind it."
  - "Climb the stairs — you hear a noise up there."
- Do not use hard words in the candidates either.
` : ""}Candidate rules: exactly 6 candidates, each specific to the scene. Mix of approaches:
- 2 cautious/protective options (safe plays)
- 2 bold/ambitious options (high risk, high reward)
- 2 creative/unusual options (lateral thinking, unexpected uses of environment or inventory)
Reference environment, inventory items, and past events when generating candidates.`,
          },
          {
            role: "user",
            content: `Location: ${req.location}
Situation: ${req.situation}
Health: ${req.health + healthDelta}/${req.maxHealth}. Chaos: ${req.chaos}/10.
Inventory: ${req.inventory.join(", ") || "nothing"}.
${req.storyFlags.length > 0 ? `Past events: ${req.storyFlags.slice(-5).join("; ")}` : ""}
Action: "${req.action}"
Ruling: grade=${grade}, consequence=${consequence}, danger=${danger}`,
          },
        ],
        temperature: 0.85,
        max_tokens: 700,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Narrator API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  const fallbackCandidates = [
    { label: "Look around carefully", description: "Survey your surroundings for anything useful" },
    { label: "Press forward cautiously", description: "Move ahead with care, watching for traps" },
    { label: "Prepare yourself", description: "Ready your tools and plan your next move" },
    { label: "Search for hidden paths", description: "Look behind rocks and along the walls" },
    { label: "Take a risk and climb", description: "Scale the nearest structure for a better view" },
    { label: "Use an item creatively", description: "Improvise with what you have in hand" },
  ];

  try {
    const parsed = JSON.parse(content);
    let candidates = parsed.candidates ?? parsed.choices;
    if (!Array.isArray(candidates) || candidates.length < 3) {
      candidates = fallbackCandidates;
    }
    return {
      narration: parsed.narration ?? content.split(".").slice(0, 2).join(".") + ".",
      nextSituation: parsed.nextSituation ?? "You find yourself in an uncertain place.",
      location: parsed.location ?? req.location,
      candidates: candidates as Array<{ label: string; description: string }>,
      inventoryAdd: ((parsed.inventoryAdd ?? []) as string[]).filter(
        (s) => s && !["none", "nothing", "n/a"].includes(s.toLowerCase().trim())
      ),
      inventoryRemove: ((parsed.inventoryRemove ?? []) as string[]).filter(
        (s) => s && !["none", "nothing", "n/a"].includes(s.toLowerCase().trim())
      ),
      objective: (parsed.objective ?? req.objective) as string,
    };
  } catch {
    return {
      narration: content || "Something happens, but the details are unclear.",
      nextSituation: "You find yourself in an uncertain place.",
      location: req.location,
      candidates: fallbackCandidates,
      inventoryAdd: [] as string[],
      inventoryRemove: [] as string[],
      objective: req.objective,
    };
  }
}

// ─── Call 3: Jev selects choices + rates risk + checks ending ───
async function callJevSelection(
  situation: string,
  candidates: Array<{ label: string; description: string }>,
  req: TurnRequest,
  grade: Grade,
  consequence: string,
  newHealth: number,
  newChaos: number,
  newInventory: string[],
  newFlags: string[]
) {
  const stateBlock = [
    `Current situation: ${situation}`,
    `Player health: ${newHealth}/${req.maxHealth}. Chaos: ${newChaos}/10.`,
    `Inventory: ${newInventory.join(", ") || "nothing"}.`,
    `Objective: ${req.objective}.`,
    newFlags.length > 0
      ? `Recent events: ${newFlags.slice(-5).join("; ")}.`
      : "",
    `Turn: ${req.turnNumber}. Latest result: ${grade}, ${consequence}.`,
    "",
    "Available actions:",
    ...candidates.map(
      (c, i) => `  action_${i}: "${c.label}" — ${c.description}`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const pickCriteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    pickCriteria[`action_${i}`] = `${c.label} — ${c.description}`;
  });

  const questions: Record<string, object> = {
    pick_cautious: {
      type: "choice",
      instructions:
        "From the available actions in `context`, select the one that is most CAUTIOUS and PROTECTIVE — the safest way to make progress given the current state.",
      criteria: pickCriteria,
    },
    pick_bold: {
      type: "choice",
      instructions:
        "From the available actions in `context`, select the one that is most BOLD and AMBITIOUS — the highest risk, highest reward option.",
      criteria: pickCriteria,
    },
    pick_wild: {
      type: "choice",
      instructions:
        "From the available actions in `context`, select the most CREATIVE and UNEXPECTED option — lateral thinking, surprising use of environment or items.",
      criteria: pickCriteria,
    },
  };

  candidates.forEach((c, i) => {
    questions[`risk_${i}`] = {
      type: "choice",
      instructions: `How risky is action_${i} ("${c.label}") for the player given the current situation, health, and chaos level in the \`context\`?`,
      criteria: {
        safe: "Low risk — unlikely to cause harm",
        risky: "Moderate risk — could go wrong",
        dangerous: "High risk — significant chance of harm or major consequence",
      },
    };
  });

  if (req.turnNumber >= 3) {
    questions.run_status = {
      type: "choice",
      instructions:
        "Given the full run summary in `context` — objective, completed events, items found, clues gathered, health, chaos — has the player achieved their objective, or is the situation now hopeless?",
      criteria: {
        solved:
          "The player has clearly achieved their main objective or reached a natural, satisfying conclusion",
        not_yet:
          "The player is still working toward their objective — more remains to be done",
        failed:
          "The situation has become so dire that achieving the objective is no longer realistically possible",
      },
    };
  }

  try {
    const res = await fetchRetry(
      "https://openrouter.ai/api/alpha/decisions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: { context: stateBlock },
          questions,
        }),
      }
    );

    if (!res.ok) throw new Error("selection call failed");

    const data = await res.json();
    return {
      answers: data.answers as Record<string, JevChoiceAnswer>,
      cost: data.usage?.cost ?? 0,
      questionCount: Object.keys(questions).length,
    };
  } catch {
    const fallbackAnswers: Record<string, JevChoiceAnswer> = {
      pick_cautious: {
        choice: "action_0",
        confidence: 0.5,
        probabilities: { action_0: 0.5 },
      },
      pick_bold: {
        choice: "action_1",
        confidence: 0.5,
        probabilities: { action_1: 0.5 },
      },
      pick_wild: {
        choice: "action_2",
        confidence: 0.5,
        probabilities: { action_2: 0.5 },
      },
    };
    candidates.forEach((_, i) => {
      fallbackAnswers[`risk_${i}`] = {
        choice: "risky",
        confidence: 0.5,
        probabilities: {},
      };
    });
    if (req.turnNumber >= 3) {
      fallbackAnswers.run_status = {
        choice: "not_yet",
        confidence: 0.5,
        probabilities: {},
      };
    }
    return {
      answers: fallbackAnswers,
      cost: 0,
      questionCount: Object.keys(questions).length,
    };
  }
}

// ─── Main handler ───
export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body: TurnRequest = await req.json();

    // Step 1: Jev outcome (Noul success + Choice consequence + Choice danger)
    const jev = await callJevOutcome(body);
    const p = jev.answers.success_chance.noul;
    const grade = gradeFromP(p);
    const diceRoll = Math.max(1, Math.min(20, Math.round(p * 20)));
    const consequence = jev.answers.consequence.choice;
    const danger = jev.answers.danger.choice;

    // Step 2: Grade-based effects
    let healthDelta = 0;
    if (grade === "CRITICAL_FAIL") healthDelta = -2;
    else if (grade === "FAIL" || grade === "PARTIAL") healthDelta = -1;

    let chaosDelta = 0;
    if (grade === "CRITICAL_FAIL") chaosDelta = 2;
    else if (grade === "FAIL" || grade === "PARTIAL") chaosDelta = 1;
    else if (grade === "CRITICAL_SUCCESS") chaosDelta = -1;

    // Step 3: Consequence effects (on top of grade)
    switch (consequence) {
      case "trigger_trap":
        healthDelta -= 1;
        chaosDelta += 1;
        break;
      case "wake_enemy":
        chaosDelta += 1;
        break;
      case "reveal_passage":
        if (grade === "CRITICAL_SUCCESS" || grade === "SUCCESS")
          chaosDelta -= 1;
        break;
    }

    // Step 4: Narrator
    const narrator = await callNarrator(
      body,
      grade,
      consequence,
      danger,
      healthDelta,
      body.simpleEnglish !== false
    );

    // Step 5: Compute new state for selection call
    const newHealth = Math.max(0, body.health + healthDelta);
    const newChaos = Math.max(0, Math.min(10, body.chaos + chaosDelta));
    const newInventory = [
      ...body.inventory,
      ...(narrator.inventoryAdd ?? []),
    ].filter((item) => !(narrator.inventoryRemove ?? []).includes(item));

    const storyFlag =
      consequence !== "nothing_notable"
        ? `${consequence.replace(/_/g, " ")}: ${narrator.narration.split(".")[0]}`
        : null;
    const newFlags = [...body.storyFlags];
    if (storyFlag) newFlags.push(storyFlag);

    // Step 6: Jev selection + risk + ending
    const selection = await callJevSelection(
      narrator.nextSituation,
      narrator.candidates,
      body,
      grade,
      consequence,
      newHealth,
      newChaos,
      newInventory,
      newFlags
    );

    // Deduplicate selections across archetypes
    const archOrder = ["pick_cautious", "pick_bold", "pick_wild"] as const;
    const archLabels: Record<string, string> = {
      pick_cautious: "cautious",
      pick_bold: "bold",
      pick_wild: "wild",
    };

    const selectedItems: { index: number; archetype: string }[] = [];
    const usedIndices = new Set<number>();

    for (const arch of archOrder) {
      const answer = selection.answers[arch];
      if (!answer) continue;
      const sorted = Object.entries(answer.probabilities).sort(
        ([, a], [, b]) => b - a
      );
      for (const [key] of sorted) {
        const idx = parseInt(key.replace("action_", ""));
        if (
          !isNaN(idx) &&
          !usedIndices.has(idx) &&
          idx < narrator.candidates.length
        ) {
          usedIndices.add(idx);
          selectedItems.push({ index: idx, archetype: archLabels[arch] });
          break;
        }
      }
    }

    for (
      let i = 0;
      selectedItems.length < 3 && i < narrator.candidates.length;
      i++
    ) {
      if (!usedIndices.has(i)) {
        usedIndices.add(i);
        selectedItems.push({ index: i, archetype: "wild" });
      }
    }

    const ratedChoices = selectedItems.map(({ index, archetype }) => {
      const candidate = narrator.candidates[index];
      const riskAnswer = selection.answers[`risk_${index}`];
      return {
        label: candidate.label,
        description: candidate.description,
        risk: riskAnswer?.choice ?? "risky",
        riskConfidence: riskAnswer?.confidence ?? 0.5,
        archetype,
      };
    });

    const rejectedCandidates = narrator.candidates
      .map((c, i) => {
        if (selectedItems.some((s) => s.index === i)) return null;
        let bestScore = 0;
        for (const arch of archOrder) {
          const prob =
            selection.answers[arch]?.probabilities?.[`action_${i}`] ?? 0;
          if (prob > bestScore) bestScore = prob;
        }
        return { label: c.label, description: c.description, score: bestScore };
      })
      .filter(
        (x): x is { label: string; description: string; score: number } =>
          x !== null
      );

    const runStatus = selection.answers.run_status?.choice ?? "not_yet";

    return NextResponse.json({
      successProb: p,
      grade,
      diceRoll,
      consequence,
      consequenceConfidence: jev.answers.consequence.confidence,
      consequenceProbabilities: jev.answers.consequence.probabilities,
      danger,
      dangerConfidence: jev.answers.danger.confidence,
      healthDelta,
      chaosDelta,
      narration: narrator.narration,
      nextSituation: narrator.nextSituation,
      location: narrator.location,
      choices: ratedChoices,
      rejectedCandidates,
      inventoryAdd: narrator.inventoryAdd ?? [],
      inventoryRemove: narrator.inventoryRemove ?? [],
      objective: narrator.objective,
      storyFlag,
      runStatus,
      jevCost: (jev.usage?.cost ?? 0) + selection.cost,
      jevDecisions: 3 + selection.questionCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Turn error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
