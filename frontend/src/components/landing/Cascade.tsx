/**
 * A 160-mark cascade: the intake scattered, the gate compressed, the evidence
 * ordered, the verdict carrying two red marks. Drawn deterministically so the
 * server and client render the same field.
 */

type Mark = { x: number; y: number; fill: string };

function build() {
  let seed = 104;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const marks: Mark[] = [];

  // Intake: scattered, two pale tones.
  for (let i = 0; i < 48; i += 1) {
    marks.push({
      x: 10 + rnd() * 250,
      y: 16 + rnd() * 268,
      fill: i % 2 === 0 ? "#D6CFBF" : "#C5BDAB",
    });
  }
  // Gate: pulled into a tight three-row ribbon.
  for (let i = 0; i < 48; i += 1) {
    marks.push({
      x: 322 + i * 4.4,
      y: 130 + (i % 3) * 16,
      fill: "#B0A793",
    });
  }
  // Evidence: ordered rows.
  for (let i = 0; i < 48; i += 1) {
    marks.push({
      x: 632 + (i % 12) * 17,
      y: 104 + Math.floor(i / 12) * 17,
      fill: "#2F3236",
    });
  }
  // Verdict: two red marks in a small ordered block.
  for (let i = 0; i < 16; i += 1) {
    marks.push({
      x: 962 + (i % 8) * 19,
      y: 136 + Math.floor(i / 8) * 19,
      fill: i < 2 ? "#B0232A" : "#2F3236",
    });
  }
  return marks;
}

const DESKTOP = build();

function mobileMarks() {
  let seed = 104;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const marks: Mark[] = [];
  for (let i = 0; i < 48; i += 1) {
    marks.push({
      x: 12 + rnd() * 316,
      y: 12 + rnd() * 126,
      fill: i % 2 === 0 ? "#D6CFBF" : "#C5BDAB",
    });
  }
  for (let i = 0; i < 48; i += 1) {
    marks.push({ x: 20 + i * 6.5, y: 178 + (i % 3) * 13, fill: "#B0A793" });
  }
  for (let i = 0; i < 48; i += 1) {
    marks.push({
      x: 54 + (i % 12) * 22,
      y: 248 + Math.floor(i / 12) * 20,
      fill: "#2F3236",
    });
  }
  for (let i = 0; i < 16; i += 1) {
    marks.push({
      x: 108 + (i % 8) * 18,
      y: 386 + Math.floor(i / 8) * 18,
      fill: i < 2 ? "#B0232A" : "#2F3236",
    });
  }
  return marks;
}

const MOBILE = mobileMarks();

const STAGES = [
  {
    name: "Vision",
    line: "Reads the key slice and the report, with measurements.",
    model: "Nemotron 3.5 Super-VL",
  },
  {
    name: "Gate",
    line: "Triages clean packets. Fails safe at 4 mm or 25%.",
    model: "Nemotron 3 Nano",
  },
  {
    name: "Evidence",
    line: "Retrieves the governing guideline. PHI never leaves.",
    model: "Tavily / cached snapshot",
  },
  {
    name: "Verdict",
    line: "Synthesises the contradiction. The span guard verifies.",
    model: "Nemotron 3 Ultra",
  },
];

export default function Cascade() {
  return (
    <div>
      <svg
        viewBox="0 0 1200 300"
        className="hidden h-auto w-full md:block"
        role="img"
        aria-label="160 marks moving from a scattered intake to a compressed gate, ordered evidence, and two flagged contradictions"
      >
        {DESKTOP.map((m, i) => (
          <rect key={i} x={m.x} y={m.y} width={8} height={8} fill={m.fill} />
        ))}
      </svg>
      <svg
        viewBox="0 0 360 460"
        className="h-auto w-full md:hidden"
        role="img"
        aria-label="160 marks moving from a scattered intake to a compressed gate, ordered evidence, and two flagged contradictions"
      >
        {MOBILE.map((m, i) => (
          <rect key={i} x={m.x} y={m.y} width={7} height={7} fill={m.fill} />
        ))}
      </svg>

      <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((s) => (
          <div key={s.name}>
            <h3 className="text-lg font-semibold text-ink">{s.name}</h3>
            <p className="mt-2 max-w-[28ch] text-[15px] leading-[1.5] text-ink-2">{s.line}</p>
            <p className="mt-3 text-[13px] text-muted">{s.model}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
