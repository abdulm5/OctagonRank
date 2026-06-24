import React, { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Crosshair,
  Dumbbell,
  Medal,
  ShieldAlert,
  Swords,
  Trophy,
} from "lucide-react";

const metaBoardDivisions = [
  {
    division: "Flyweight",
    champion: "Joshua Van",
    rankings: [
      "Alexandre Pantoja",
      "Manel Kape",
      "Tatsuro Taira",
      "Brandon Royval",
      "Loneer Kavanagh",
      "Kyoji Horiguchi",
      "Alex Almabayev",
      "Amir Albazi",
      "Brandon Moreno",
      "Kevin Borjas",
      "Mitch Raposo",
      "Sumudaerji",
      "Steve Erceg",
      "Alex Perez",
      "Charles Johnson",
    ],
  },
  {
    division: "Bantamweight",
    champion: "Petr Yan",
    rankings: [
      "Merab Dvalishvili",
      "Umar Nurmagomedov",
      "Sean O'Malley",
      "Cory Sandhagen",
      "Mario Bautista",
      "Song Yadong",
      "David Martinez",
      "Raoni Barcelos",
      "Marcus McGhee",
      "Farid Basharat",
      "Deiveson Figueiredo",
      "Aiemann Zahabi",
      "Charles Jourdain",
      "Bryce Mitchell",
      "Montel Jackson",
    ],
  },
  {
    division: "Featherweight",
    champion: "Alexander Volkanovski",
    rankings: [
      "Movsar Evloev",
      "Diego Lopes",
      "Lerone Murphy",
      "Aljamain Sterling",
      "Arnold Allen",
      "Jean Silva",
      "Pat Sabatini",
      "Youssef Zalal",
      "Nathaniel Wood",
      "Kevin Vallejos",
      "Melquizael Costa",
      "Steve Garcia",
      "Aaron Pico",
      "Joanderson Brito",
      "Jose Miguel Delgado",
    ],
  },
  {
    division: "Lightweight",
    champion: "Justin Gaethje",
    rankings: [
      "Ilia Topuria",
      "Arman Tsarukyan",
      "Charles Oliveira",
      "Max Holloway",
      "Benoit Saint Denis",
      "Mateusz Gamrot",
      "Renato Moicano",
      "Quillan Salkilld",
      "Paddy Pimblett",
      "Mauricio Ruffy",
      "Dan Hooker",
      "Tom Nolan",
      "Manuel Torres",
      "Grant Dawson",
      "Rafa Garcia",
    ],
  },
  {
    division: "Welterweight",
    champion: "Islam Makhachev",
    rankings: [
      "Carlos Prates",
      "Ian Machado Garry",
      "Michael Morales",
      "Jack Della Maddalena",
      "Sean Brady",
      "Gabriel Bonfim",
      "Belal Muhammad",
      "Leon Edwards",
      "Joaquin Buckley",
      "Kamaru Usman",
      "Mike Malott",
      "Michael Venom Page",
      "Daniel Rodriguez",
      "Uros Medic",
      "Yaroslav Amosov",
    ],
  },
  {
    division: "Middleweight",
    champion: "Sean Strickland",
    rankings: [
      "Khamzat Chimaev",
      "Dricus Du Plessis",
      "Nassourdine Imavov",
      "Brendan Allen",
      "Joe Pyfer",
      "Caio Borralho",
      "Anthony Hernandez",
      "Israel Adesanya",
      "Gregory Rodrigues",
      "Jared Cannonier",
      "Christian Leroy Duncan",
      "Bo Nickal",
      "Paulo Costa",
      "Ikram Aliskerov",
      "Reinier De Ridder",
    ],
  },
  {
    division: "Light Heavyweight",
    champion: "Carlos Ulberg",
    rankings: [
      "Alex Pereira",
      "Magomed Ankalaev",
      "Jiri Prochazka",
      "Paulo Costa",
      "Jamahal Hill",
      "Khalil Rountree Jr.",
      "Dominick Reyes",
      "Volkan Oezdemir",
      "Azamat Murzakanov",
      "Bogdan Guskov",
      "Dustin Jacoby",
      "Navajo Stirling",
      "Alonzo Menifield",
      "Johnny Walker",
      "Jan Blachowicz",
    ],
  },
  {
    division: "Heavyweight",
    champion: "Tom Aspinall",
    rankings: [
      "Ciryl Gane",
      "Alexander Volkov",
      "Sergei Pavlovich",
      "Alex Pereira",
      "Josh Hokit",
      "Waldo Cortes-Acosta",
      "Rizvan Kuniev",
      "Curtis Blaydes",
      "Serghei Spivac",
      "Vitor Petrino",
      "Valter Walker",
      "Brando Pericic",
      "Mario Pinto",
      "Mick Parkin",
      "Ryan Spann",
    ],
  },
];

const mediaRankingOverrides = {
  Flyweight: [
    "Alexandre Pantoja",
    "Manel Kape",
    "Tatsuro Taira",
    "Brandon Royval",
    "Kyoji Horiguchi",
    "Lone'er Kavanagh",
    "Amir Albazi",
    "Brandon Moreno",
    "Asu Almabayev",
    "Steve Erceg",
    "Alex Perez",
    "Tim Elliott",
    "Tagir Ulanbekov",
    "Charles Johnson",
    "Edgar Chairez",
  ],
  Bantamweight: [
    "Merab Dvalishvili",
    "Sean O'Malley",
    "Umar Nurmagomedov",
    "Cory Sandhagen",
    "Song Yadong",
    "Aiemann Zahabi",
    "Mario Bautista",
    "David Martinez",
    "Deiveson Figueiredo",
    "Marlon Vera",
    "Payton Talbott",
    "Raul Rosas Jr.",
    "Vinicius Oliveira",
    "Raoni Barcelos",
    "Marcus McGhee",
  ],
  Featherweight: [
    "Movsar Evloev",
    "Diego Lopes",
    "Lerone Murphy",
    "Aljamain Sterling",
    "Yair Rodriguez",
    "Jean Silva",
    "Arnold Allen",
    "Youssef Zalal",
    "Kevin Vallejos",
    "Steve Garcia",
    "Brian Ortega",
    "Aaron Pico",
    "Melquizael Costa",
    "David Onama",
    "Josh Emmett",
  ],
  Lightweight: [
    "Ilia Topuria",
    "Arman Tsarukyan",
    "Charles Oliveira",
    "Max Holloway",
    "Benoit Saint Denis",
    "Paddy Pimblett",
    "Mauricio Ruffy",
    "Mateusz Gamrot",
    "Dan Hooker",
    "Renato Moicano",
    "Rafael Fiziev",
    "Quillan Salkilld",
    "Tom Nolan",
    "Beneil Dariush",
    "Manuel Torres",
  ],
  Welterweight: [
    "Ian Machado Garry",
    "Carlos Prates",
    "Michael Morales",
    "Jack Della Maddalena",
    "Gabriel Bonfim",
    "Sean Brady",
    "Belal Muhammad",
    "Leon Edwards",
    "Kamaru Usman",
    "Joaquin Buckley",
    "Yaroslav Amosov",
    "Mike Malott",
    "Michael Venom Page",
    "Uros Medic",
    "Daniel Rodriguez",
  ],
  Middleweight: [
    "Khamzat Chimaev",
    "Dricus Du Plessis",
    "Nassourdine Imavov",
    "Brendan Allen",
    "Caio Borralho",
    "Anthony Hernandez",
    "Joe Pyfer",
    "Reinier De Ridder",
    "Israel Adesanya",
    "Robert Whittaker",
    "Jared Cannonier",
    "Gregory Rodrigues",
    "Christian Leroy Duncan",
    "Roman Dolidze",
    "Bo Nickal",
  ],
  "Light Heavyweight": [
    "Magomed Ankalaev",
    "Jiri Prochazka",
    "Alex Pereira",
    "Jan Blachowicz",
    "Khalil Rountree Jr.",
    "Jamahal Hill",
    "Paulo Costa",
    "Azamat Murzakanov",
    "Volkan Oezdemir",
    "Bogdan Guskov",
    "Dominick Reyes",
    "Nikita Krylov",
    "Johnny Walker",
    "Alonzo Menifield",
    "Aleksandar Rakic",
  ],
  Heavyweight: [
    "Ciryl Gane",
    "Alexander Volkov",
    "Sergei Pavlovich",
    "Josh Hokit",
    "Waldo Cortes-Acosta",
    "Serghei Spivac",
    "Curtis Blaydes",
    "Rizvan Kuniev",
    "Tyrell Fortune",
    "Ante Delija",
    "Derrick Lewis",
    "Marcin Tybura",
    "Brando Pericic",
    "Valter Walker",
    "Mick Parkin",
  ],
};

const ourRankingOverrides = {
  Flyweight: [
    "Alexandre Pantoja",
    "Brandon Royval",
    "Tatsuro Taira",
    "Manel Kape",
    "Charles Johnson",
    "Joshua Van",
    "Kyoji Horiguchi",
    "Loneer Kavanagh",
    "Brandon Moreno",
    "Amir Albazi",
    "Asu Almabayev",
    "Steve Erceg",
    "Alex Perez",
    "Sumudaerji",
    "Mitch Raposo",
  ],
  Bantamweight: [
    "Merab Dvalishvili",
    "Sean O'Malley",
    "Umar Nurmagomedov",
    "Cory Sandhagen",
    "Raoni Barcelos",
    "Mario Bautista",
    "Song Yadong",
    "Payton Talbott",
    "David Martinez",
    "Marcus McGhee",
    "Farid Basharat",
    "Deiveson Figueiredo",
    "Aiemann Zahabi",
    "Bryce Mitchell",
    "Montel Jackson",
  ],
  Featherweight: [
    "Movsar Evloev",
    "Diego Lopes",
    "Lerone Murphy",
    "Aljamain Sterling",
    "Jean Silva",
    "Arnold Allen",
    "Nathaniel Wood",
    "Youssef Zalal",
    "Kevin Vallejos",
    "Steve Garcia",
    "Pat Sabatini",
    "Yair Rodriguez",
    "Melquizael Costa",
    "Aaron Pico",
    "Jose Miguel Delgado",
  ],
  Lightweight: [
    "Ilia Topuria",
    "Arman Tsarukyan",
    "Charles Oliveira",
    "Max Holloway",
    "Benoit Saint Denis",
    "Mateusz Gamrot",
    "Mauricio Ruffy",
    "Paddy Pimblett",
    "Renato Moicano",
    "Dan Hooker",
    "Rafael Fiziev",
    "Quillan Salkilld",
    "Beneil Dariush",
    "Tom Nolan",
    "Manuel Torres",
  ],
  Welterweight: [
    "Ian Machado Garry",
    "Carlos Prates",
    "Michael Morales",
    "Jack Della Maddalena",
    "Sean Brady",
    "Gabriel Bonfim",
    "Belal Muhammad",
    "Leon Edwards",
    "Kamaru Usman",
    "Joaquin Buckley",
    "Yaroslav Amosov",
    "Mike Malott",
    "Michael Venom Page",
    "Uros Medic",
    "Daniel Rodriguez",
  ],
  Middleweight: [
    "Khamzat Chimaev",
    "Dricus Du Plessis",
    "Nassourdine Imavov",
    "Brendan Allen",
    "Anthony Hernandez",
    "Caio Borralho",
    "Joe Pyfer",
    "Israel Adesanya",
    "Reinier De Ridder",
    "Jared Cannonier",
    "Gregory Rodrigues",
    "Christian Leroy Duncan",
    "Bo Nickal",
    "Paulo Costa",
    "Ikram Aliskerov",
  ],
  "Light Heavyweight": [
    "Magomed Ankalaev",
    "Alex Pereira",
    "Jiri Prochazka",
    "Khalil Rountree Jr.",
    "Jamahal Hill",
    "Jan Blachowicz",
    "Paulo Costa",
    "Dominick Reyes",
    "Azamat Murzakanov",
    "Volkan Oezdemir",
    "Bogdan Guskov",
    "Dustin Jacoby",
    "Johnny Walker",
    "Alonzo Menifield",
    "Navajo Stirling",
  ],
  Heavyweight: [
    "Ciryl Gane",
    "Alexander Volkov",
    "Sergei Pavlovich",
    "Curtis Blaydes",
    "Rizvan Kuniev",
    "Serghei Spivac",
    "Waldo Cortes-Acosta",
    "Josh Hokit",
    "Vitor Petrino",
    "Tyrell Fortune",
    "Ante Delija",
    "Valter Walker",
    "Brando Pericic",
    "Mario Pinto",
    "Mick Parkin",
  ],
};

function buildRankingSource(overrides = {}) {
  return metaBoardDivisions.map((division) => ({
    ...division,
    rankings: overrides[division.division] ?? division.rankings,
  }));
}

const rankingSources = {
  ours: {
    label: "Our model",
    eyebrow: "Explainable model",
    description: "Head-to-head guardrails and context-aware decay applied.",
    divisions: buildRankingSource(ourRankingOverrides),
  },
  meta: {
    label: "Meta",
    eyebrow: "UFC Meta",
    description: "The AI-influenced UFC ranking board from the reference screenshot.",
    divisions: metaBoardDivisions,
  },
  media: {
    label: "Media",
    eyebrow: "Media panel",
    description: "The current media-panel men’s rankings from your pasted UFC text.",
    divisions: buildRankingSource(mediaRankingOverrides),
  },
};

const sourceOrder = ["ours", "meta", "media"];

const profileOverrides = {
  "Ian Machado Garry": {
    record: "16-1",
    wins: 16,
    sigStrikes: 912,
    koTko: 7,
    submissions: 1,
    score: 89.7,
    recordLine: "Recent win over Carlos Prates keeps the head-to-head guardrail active.",
    winsList: ["Carlos Prates", "Michael Page", "Neil Magny", "Daniel Rodriguez"],
    method: [
      ["Head-to-head", 94, "Direct win over Prates blocks Prates from jumping ahead on activity alone."],
      ["Opponent strength", 84, "Prates grades as a high-value ranked win."],
      ["Fight context", 58, "Decision win, so the model does not score it like a finish."],
      ["Activity confidence", 73, "Recent schedule gives the rating a stable sample."],
    ],
  },
  "Carlos Prates": {
    record: "21-7",
    wins: 21,
    sigStrikes: 802,
    koTko: 16,
    submissions: 3,
    score: 84.4,
    recordLine: "Finish streak is strong, but the Garry loss caps his current rank.",
    winsList: ["Neil Magny", "Li Jingliang", "Charles Radtke", "Trevin Giles"],
    method: [
      ["Finish bonus", 91, "High knockout rate gives him a meaningful boost."],
      ["Activity confidence", 86, "Busy current schedule keeps the sample fresh."],
      ["Head-to-head cap", 26, "Loss to Garry prevents a direct contradiction."],
      ["Opponent strength", 66, "Needs one more elite win to override the cap."],
    ],
  },
  "Kamaru Usman": {
    record: "21-5",
    wins: 21,
    sigStrikes: 1862,
    koTko: 9,
    submissions: 1,
    score: 87.4,
    recordLine: "Inactivity lowers confidence, but the Buckley win still matters.",
    winsList: ["Joaquin Buckley", "Colby Covington", "Gilbert Burns", "Tyron Woodley"],
    method: [
      ["Head-to-head", 96, "Direct Buckley win blocks Buckley from passing without major new work."],
      ["Opponent strength", 82, "Elite historical schedule still carries value."],
      ["Activity confidence", 41, "Layoff lowers certainty, not the entire resume."],
      ["Recent form", 63, "Latest result remains positive."],
    ],
  },
  "Joaquin Buckley": {
    record: "22-7",
    wins: 22,
    sigStrikes: 1219,
    koTko: 15,
    submissions: 0,
    score: 84.9,
    recordLine: "Activity and finishes help, but the Usman loss remains binding.",
    winsList: ["Colby Covington", "Stephen Thompson", "Vicente Luque", "Andre Fialho"],
    method: [
      ["Activity", 88, "Busy schedule raises confidence."],
      ["Finish bonus", 74, "Power wins add margin."],
      ["Head-to-head cap", 24, "Loss to Usman prevents the contradiction."],
      ["Opponent strength", 68, "Needs a stronger post-loss win."],
    ],
  },
  "Jean Silva": {
    record: "16-2",
    wins: 16,
    sigStrikes: 673,
    koTko: 11,
    submissions: 2,
    score: 88.9,
    recordLine: "Direct win over Arnold Allen keeps the ordering clean.",
    winsList: ["Arnold Allen", "Drew Dober", "Charles Jourdain", "Westin Wilson"],
    method: [
      ["Head-to-head", 92, "Recent Allen win is treated as a hard ordering rule."],
      ["Finish bonus", 89, "Repeated finishes separate him from decision-heavy resumes."],
      ["Activity confidence", 86, "Fresh sample keeps the rating stable."],
      ["Opponent strength", 78, "Allen win grades as a top-band result."],
    ],
  },
  "Jan Blachowicz": {
    record: "29-11-1",
    wins: 29,
    sigStrikes: 1324,
    koTko: 9,
    submissions: 9,
    score: 82.7,
    recordLine: "Close elite fights soften the penalty from inactivity and losses.",
    winsList: ["Israel Adesanya", "Dominick Reyes", "Corey Anderson", "Luke Rockhold"],
    method: [
      ["Close-fight context", 88, "Close fights against elite opponents are not treated like clear losses."],
      ["Opponent strength", 92, "Recent schedule is extremely difficult."],
      ["Activity confidence", 32, "Long layoffs create uncertainty."],
      ["Legacy decay", 51, "Older title wins fade but do not disappear."],
    ],
  },
  "Benoit Saint Denis": {
    record: "17-3",
    wins: 17,
    sigStrikes: 483,
    koTko: 6,
    submissions: 11,
    score: 86.8,
    recordLine:
      "BSD gets a strong context score from finishing upside and pressure volume, while defensive damage and takedown efficiency keep the model from overrating him.",
    winsList: ["Mauricio Ruffy", "Thiago Moises", "Matt Frevola", "Ismael Bonfim"],
    method: [
      ["Finish threat", 96, "All tracked wins in this data slice are finishes, with submission wins carrying the largest share."],
      ["Striking pace", 84, "5.62 significant strikes landed per minute supports a pressure-heavy profile."],
      ["Defensive risk", 48, "4.09 significant strikes absorbed per minute and 42% striking defense lower the ceiling."],
      ["Grappling output", 78, "4.19 takedown attempts per 15 and 1.75 submission attempts per 15 flag real finishing danger."],
    ],
    statsDetail: {
      sourceLabel: "BSD screenshot stats",
      finishStats: [
        ["Wins by knockout", 6],
        ["Wins by submission", 11],
        ["First round finishes", 8],
      ],
      accuracy: [
        {
          label: "Striking accuracy",
          percent: 59,
          landedLabel: "Sig. strikes landed",
          landed: 483,
          attemptedLabel: "Sig. strikes attempted",
          attempted: 825,
        },
        {
          label: "Takedown accuracy",
          percent: 3,
          landedLabel: "Takedowns landed",
          landed: 2,
          attemptedLabel: "Takedowns attempted",
          attempted: 67,
        },
      ],
      rates: [
        ["Sig. str. landed", "5.62", "per min"],
        ["Sig. str. absorbed", "4.09", "per min"],
        ["Takedown avg", "4.19", "per 15 min"],
        ["Submission avg", "1.75", "per 15 min"],
        ["Sig. str. defense", "42%", ""],
        ["Takedown defense", "72%", ""],
        ["Knockdown avg", "0.87", ""],
        ["Average fight time", "07:10", ""],
      ],
      positions: [
        ["Standing", 244, 51],
        ["Clinch", 87, 18],
        ["Ground", 152, 31],
      ],
      targets: [
        ["Head", 303, 63],
        ["Body", 128, 27],
        ["Leg", 52, 11],
      ],
      winMethods: [
        ["KO/TKO", 6, 35],
        ["DEC", 0, 0],
        ["SUB", 11, 65],
      ],
    },
  },
};

const methodDraft = [
  {
    title: "Head-to-head guardrails",
    body: "Placeholder: recent direct wins should prevent obvious contradictions unless the losing fighter earns a clearly stronger post-loss resume.",
  },
  {
    title: "Opponent strength",
    body: "Placeholder: wins should scale based on opponent rating at fight time, current opponent rating, and how that win aged.",
  },
  {
    title: "Fight context",
    body: "Placeholder: finishes, knockdowns, control time, scorecard spread, and close decisions will eventually affect margin.",
  },
  {
    title: "Confidence decay",
    body: "Placeholder: inactivity should lower certainty instead of deleting a fighter's prior accomplishments.",
  },
];

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function seedValue(name, rank, offset = 0) {
  const total = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total + rank * 17 + offset;
}

function makeProfile(name, division, rank = 0, isChampion = false) {
  const override = profileOverrides[name] ?? {};
  const seed = seedValue(name, rank || 1);
  const wins = override.wins ?? Math.max(10, 28 - Math.min(rank, 14) + (seed % 5));
  const koTko = override.koTko ?? Math.max(1, Math.round(wins * (0.28 + (seed % 5) * 0.04)));
  const submissions = override.submissions ?? Math.max(0, Math.round(wins * (0.08 + (seed % 3) * 0.03)));
  const sigStrikes = override.sigStrikes ?? 360 + wins * 41 + (seed % 210);
  const score = override.score ?? Number((94.5 - rank * 1.45 + (seed % 8) * 0.12 + (isChampion ? 3.4 : 0)).toFixed(1));
  const record = override.record ?? `${wins}-${Math.max(0, 2 + (seed % 7))}`;

  return {
    id: `${slug(division)}-${isChampion ? "champion" : rank}-${slug(name)}`,
    name,
    division,
    rank,
    isChampion,
    record,
    wins,
    sigStrikes,
    koTko,
    submissions,
    score,
    recordLine:
      override.recordLine ??
      (isChampion
        ? "Champion baseline is separated from contender rankings and used as the division reference point."
        : "Prototype score built from resume quality, fight context, activity confidence, and direct-result checks."),
    winsList:
      override.winsList ??
      [`Ranked win sample ${Math.max(1, rank)}`, "Recent UFC win", "Quality opponent check", "Activity sample"],
    method:
      override.method ??
      [
        ["Opponent strength", Math.max(40, 92 - rank * 3), "Placeholder strength score based on ranked opponent quality."],
        ["Fight context", 58 + (seed % 31), "Placeholder margin score for finishes, strikes, control, and scorecards."],
        ["Activity confidence", 50 + (seed % 38), "Placeholder confidence score from recent fight frequency."],
        ["Head-to-head check", Math.max(34, 86 - rank * 2), "Placeholder guardrail for direct wins and recent losses."],
      ],
    statsDetail: override.statsDetail,
  };
}

export default function App() {
  const [activeView, setActiveView] = useState("rankings");
  const [rankingSource, setRankingSource] = useState("ours");
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const activeSource = rankingSources[rankingSource];

  const flattenedAthletes = useMemo(() => {
    return activeSource.divisions.flatMap((division) => [
      makeProfile(division.champion, division.division, 0, true),
      ...division.rankings.map((name, index) => makeProfile(name, division.division, index + 1, false)),
    ]);
  }, [activeSource]);

  function openAthlete(profile) {
    setSelectedAthlete(profile);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function closeAthlete() {
    setSelectedAthlete(null);
  }

  return (
    <LayoutGroup>
      <main className="page-shell">
        <header className="site-header">
          <button
            className="wordmark"
            type="button"
            onClick={() => {
              setActiveView("rankings");
              setSelectedAthlete(null);
            }}
          >
            OctagonRank
          </button>
          <nav aria-label="Primary">
            <button
              className={activeView === "rankings" ? "nav-tab active" : "nav-tab"}
              type="button"
              onClick={() => {
                setActiveView("rankings");
                setSelectedAthlete(null);
              }}
            >
              Rankings
            </button>
            <button
              className={activeView === "methodology" ? "nav-tab active" : "nav-tab"}
              type="button"
              onClick={() => {
                setActiveView("methodology");
                setSelectedAthlete(null);
              }}
            >
              Methodology
            </button>
            <button
              className={activeView === "audit" ? "nav-tab active" : "nav-tab"}
              type="button"
              onClick={() => {
                setActiveView("audit");
                setSelectedAthlete(null);
              }}
            >
              Audit
            </button>
          </nav>
        </header>

        <AnimatePresence mode="popLayout">
          {activeView === "rankings" && !selectedAthlete && (
            <RankingBoard
              key="ranking-board"
              divisions={activeSource.divisions}
              source={rankingSource}
              onSelect={openAthlete}
              onSourceChange={setRankingSource}
            />
          )}

          {activeView === "rankings" && selectedAthlete && (
            <AthleteProfile
              key="athlete-profile"
              athlete={selectedAthlete}
              sourceLabel={activeSource.label}
              onBack={closeAthlete}
            />
          )}

          {activeView === "methodology" && <MethodologyView key="methodology-view" />}

          {activeView === "audit" && <AuditView key="audit-view" athletes={flattenedAthletes} />}
        </AnimatePresence>
      </main>
    </LayoutGroup>
  );
}

function RankingBoard({ divisions, source, onSourceChange, onSelect }) {
  const activeSource = rankingSources[source];

  return (
    <motion.section
      className="board-page"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.985, filter: "blur(5px)" }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="board-heading">
        <div>
          <p>{activeSource.eyebrow}</p>
          <h1>Fighter Rankings</h1>
        </div>
        <span>{activeSource.description}</span>
      </div>

      <div className="source-toolbar" aria-label="Ranking source">
        <span>Compare source</span>
        <div>
          {sourceOrder.map((sourceKey) => (
            <button
              key={sourceKey}
              className={source === sourceKey ? "source-button active" : "source-button"}
              type="button"
              onClick={() => onSourceChange(sourceKey)}
            >
              {rankingSources[sourceKey].label}
            </button>
          ))}
        </div>
      </div>

      <div className="division-grid">
        {divisions.map((division) => (
          <DivisionColumn key={division.division} division={division} onSelect={onSelect} />
        ))}
      </div>
    </motion.section>
  );
}

function DivisionColumn({ division, onSelect }) {
  const champion = makeProfile(division.champion, division.division, 0, true);

  return (
    <section className="division-card" aria-label={`${division.division} rankings`}>
      <button className="champion-block" type="button" onClick={() => onSelect(champion)}>
        <span>{division.division}</span>
        <strong>{division.champion}</strong>
        <small>Champion</small>
        <ChampionPortrait athlete={champion} />
      </button>

      <ol className="ranking-list">
        {division.rankings.map((name, index) => {
          const athlete = makeProfile(name, division.division, index + 1, false);
          return (
            <li key={athlete.id}>
              <button type="button" onClick={() => onSelect(athlete)}>
                <span>{index + 1}</span>
                <strong>{name}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ChampionPortrait({ athlete, large = false }) {
  return (
    <div className={large ? "fighter-portrait large" : "fighter-portrait"} aria-hidden="true">
      <div className="belt" />
      <div className="torso" />
      <div className="head">{initials(athlete.name)}</div>
    </div>
  );
}

function AthleteProfile({ athlete, sourceLabel, onBack }) {
  return (
    <motion.section
      className="profile-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to rankings
      </button>

      <div className="profile-hero">
        <div className="profile-title">
          <p>{athlete.division}</p>
          <motion.h1
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          >
            {athlete.name}
          </motion.h1>
          <span>
            {sourceLabel} / {athlete.isChampion ? "Champion" : `Rank #${athlete.rank}`}
          </span>
        </div>
        <ChampionPortrait athlete={athlete} large />
      </div>

      <div className="profile-grid">
        <section className="profile-summary">
          <div className="score-lockup">
            <span>OctagonRank score</span>
            <strong>{athlete.score}</strong>
          </div>
          <p>{athlete.recordLine}</p>
        </section>

        <section className="stat-grid" aria-label={`${athlete.name} stats`}>
          <StatCard icon={Medal} label="Record" value={athlete.record} />
          <StatCard icon={Trophy} label="Wins" value={athlete.wins} />
          <StatCard icon={BarChart3} label="Sig strikes" value={athlete.sigStrikes.toLocaleString()} />
          <StatCard icon={Crosshair} label="TKO/KOs" value={athlete.koTko} />
          <StatCard icon={Swords} label="Submissions" value={athlete.submissions} />
          <StatCard icon={Activity} label="Activity" value={athlete.isChampion ? "Baseline" : "Tracked"} />
        </section>

        {athlete.statsDetail && <FightStatsPanel stats={athlete.statsDetail} />}

        <section className="wins-panel">
          <div className="section-kicker">Wins</div>
          <h2>Best tracked wins</h2>
          <ol>
            {athlete.winsList.map((win) => (
              <li key={win}>{win}</li>
            ))}
          </ol>
        </section>

        <section className="score-panel">
          <div className="section-kicker">Methodology</div>
          <h2>Why this score</h2>
          <div className="method-score-list">
            {athlete.method.map(([label, value, note]) => (
              <article key={label}>
                <div>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
                <div className="method-meter" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                </div>
                <p>{note}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </motion.section>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <article>
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FightStatsPanel({ stats }) {
  return (
    <section className="fight-stats-panel" aria-label="Detailed fight statistics">
      <div className="fight-stats-heading">
        <div>
          <div className="section-kicker">Fight stats</div>
          <h2>Tracked performance profile</h2>
        </div>
        <span>{stats.sourceLabel}</span>
      </div>

      <div className="finish-strip">
        {stats.finishStats.map(([label, value]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>

      <div className="accuracy-grid">
        {stats.accuracy.map((item) => (
          <AccuracyCard key={item.label} item={item} />
        ))}
      </div>

      <div className="rate-board">
        {stats.rates.map(([label, value, unit]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            {unit && <small>{unit}</small>}
          </article>
        ))}
      </div>

      <div className="distribution-grid">
        <DistributionCard title="Sig. str. by position" items={stats.positions} />
        <TargetCard items={stats.targets} />
        <DistributionCard title="Win by method" items={stats.winMethods} />
      </div>
    </section>
  );
}

function AccuracyCard({ item }) {
  return (
    <article className="accuracy-card">
      <div className="accuracy-ring" style={{ "--accuracy": `${item.percent}%` }}>
        <strong>{item.percent}%</strong>
      </div>
      <div>
        <h3>{item.label}</h3>
        <dl>
          <div>
            <dt>{item.landedLabel}</dt>
            <dd>{item.landed}</dd>
          </div>
          <div>
            <dt>{item.attemptedLabel}</dt>
            <dd>{item.attempted}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function DistributionCard({ title, items }) {
  return (
    <article className="distribution-card">
      <h3>{title}</h3>
      <div className="distribution-list">
        {items.map(([label, value, percent]) => (
          <div key={label} className="distribution-row">
            <span>{label}</span>
            <div className="distribution-meter" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
            <strong>
              {value} <em>({percent}%)</em>
            </strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function TargetCard({ items }) {
  return (
    <article className="distribution-card target-card">
      <h3>Sig. str. by target</h3>
      <div className="target-layout">
        <div className="target-figure" aria-hidden="true">
          <span className="target-head" />
          <span className="target-body" />
          <span className="target-arm left" />
          <span className="target-arm right" />
          <span className="target-leg left" />
          <span className="target-leg right" />
        </div>
        <div className="distribution-list">
          {items.map(([label, value, percent]) => (
            <div key={label} className={`distribution-row target-row target-${label.toLowerCase()}-row`}>
              <span>{label}</span>
              <div className="distribution-meter" aria-hidden="true">
                <i style={{ width: `${percent}%` }} />
              </div>
              <strong>
                {value} <em>{percent}%</em>
              </strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function MethodologyView() {
  return (
    <motion.section
      className="methodology-page"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="methodology-hero">
        <p>Methodology</p>
        <h1>Scoring model draft</h1>
        <span>Placeholder until the real model is implemented</span>
      </div>

      <div className="methodology-layout">
        <section className="formula-card">
          <div className="formula-topline">
            <span>Status</span>
            <strong>Draft</strong>
          </div>
          <h2>Current methodology is placeholder text.</h2>
          <p>
            This screen is reserved for the final ranking explanation. Once the backend model exists, this page should
            document the exact inputs, weights, edge cases, and examples used to produce each ranking.
          </p>
          <div className="formula-box">
            <span>Future formula slot</span>
            <code>
              final_score = base_rating + opponent_strength + fight_context + head_to_head_guardrail -
              confidence_decay
            </code>
          </div>
        </section>

        <section className="method-draft-grid" aria-label="Planned methodology sections">
          {methodDraft.map((item) => (
            <article key={item.title}>
              <span>Ranking signal</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </section>
      </div>
    </motion.section>
  );
}

function AuditView({ athletes }) {
  const reviewCount = athletes.filter((athlete) => athlete.score < 84 && !athlete.isChampion).length;

  return (
    <motion.section
      className="audit-page"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="methodology-hero">
        <p>Audit</p>
        <h1>Ranking checks</h1>
        <span>Contradiction detection placeholder</span>
      </div>

      <div className="audit-board">
        <article>
          <ShieldAlert size={22} aria-hidden="true" />
          <h2>Head-to-head conflicts</h2>
          <p>Placeholder check for fighters ranked above opponents who recently beat them.</p>
        </article>
        <article>
          <Dumbbell size={22} aria-hidden="true" />
          <h2>Resume ceiling</h2>
          <p>{reviewCount} contender profiles are currently below the review threshold.</p>
        </article>
        <article>
          <BadgeCheck size={22} aria-hidden="true" />
          <h2>Data status</h2>
          <p>Prototype data is hardcoded. UFCStats ingestion should replace this layer later.</p>
        </article>
      </div>
    </motion.section>
  );
}
