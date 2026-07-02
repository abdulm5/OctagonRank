import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Crosshair,
  Medal,
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
      "Lone’er Kavanagh",
      { name: "Asu Almabayev", change: 1 },
      { name: "Kyoji Horiguchi", change: -1 },
      "Amir Albazi",
      "Brandon Moreno",
      "Kevin Borjas",
      "Mitch Raposo",
      "Sumudaerji",
      "Steve Erceg",
      "Alex Perez",
      { name: "Joseph Morales", change: "NR" },
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
      "Benoît Saint Denis",
      "Mateusz Gamrot",
      "Renato Moicano",
      "Quillan Salkilld",
      "Paddy Pimblett",
      "Mauricio Ruffy",
      "Dan Hooker",
      "Tom Nolan",
      { name: "Rafael Fiziev", change: "NR" },
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
      "Uroš Medić",
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
      { name: "Joe Pyfer", change: 1 },
      { name: "Brendan Allen", change: -1 },
      "Caio Borralho",
      "Anthony Hernandez",
      "Israel Adesanya",
      "Gregory Rodrigues",
      { name: "Ikram Aliskerov", change: 4 },
      { name: "Jared Cannonier", change: -1 },
      { name: "Christian Leroy Duncan", change: -1 },
      { name: "Bo Nickal", change: -1 },
      { name: "Paulo Costa", change: -1 },
      { name: "Abus Magomedov", change: "NR" },
    ],
  },
  {
    division: "Light Heavyweight",
    champion: "Carlos Ulberg",
    rankings: [
      "Alex Pereira",
      "Magomed Ankalaev",
      "Jiří Procházka",
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
      "Jan Błachowicz",
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
      "Waldo Cortes Acosta",
      "Rizvan Kuniev",
      "Curtis Blaydes",
      "Serghei Spivac",
      "Vitor Petrino",
      "Valter Walker",
      "Brando Peričić",
      "Mario Pinto",
      "Mick Parkin",
      "Ryan Spann",
    ],
  },
  {
    division: "Women's Strawweight",
    champion: "Mackenzie Dern",
    rankings: [
      "Zhang Weili",
      "Virna Jandiroba",
      "Tatiana Suarez",
      "Gillian Robertson",
      "Yan Xiaonan",
      "Piera Rodriguez",
      "Tabatha Ricci",
      "Denise Gomes",
      "Mizuki",
      "Alexia Thainara",
      "Amanda Lemos",
      "Loopy Godinez",
      "Jaqueline Amorim",
      "Fatima Kline",
      "Talita Alencar",
    ],
  },
  {
    division: "Women's Flyweight",
    champion: "Valentina Shevchenko",
    rankings: [
      "Natalia Silva",
      "Manon Fiorot",
      "Alexa Grasso",
      "Erin Blanchfield",
      "Zhang Weili",
      "Jasmine Jasudavicius",
      "Rose Namajunas",
      "Tracy Cortez",
      "Maycee Barber",
      "Wang Cong",
      "Miranda Maverick",
      "JJ Aldrich",
      "Karine Silva",
      "Eduarda Moura",
      "Casey O'Neill",
    ],
  },
  {
    division: "Women's Bantamweight",
    champion: "Kayla Harrison",
    rankings: [
      "Joselyne Edwards",
      "Norma Dumont",
      "Luana Santos",
      "Julianna Peña",
      "Ailin Perez",
      "Yana Santos",
      "Jacqueline Cavalcanti",
      "Michelle Montague",
      "Melissa Croden",
      "Karol Rosa",
      "Bia Mesquita",
      "Irene Aldana",
      "Macy Chiasson",
      "Daria Zhelezniakova",
      "Raquel Pennington",
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
    "Lone’er Kavanagh",
    { name: "Asu Almabayev", change: 2 },
    { name: "Amir Albazi", change: -1 },
    { name: "Brandon Moreno", change: -1 },
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
    { name: "Raoni Barcelos", change: 1 },
    { name: "Marcus McGhee", change: 1 },
    { name: "Farid Basharat", change: "NR" },
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
    { name: "Patricio Pitbull", change: "NR" },
  ],
  Lightweight: [
    "Ilia Topuria",
    "Arman Tsarukyan",
    "Charles Oliveira",
    "Max Holloway",
    "Benoît Saint Denis",
    "Paddy Pimblett",
    "Mauricio Ruffy",
    "Mateusz Gamrot",
    "Dan Hooker",
    { name: "Rafael Fiziev", change: 1 },
    { name: "Renato Moicano", rank: 10 },
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
    "Uroš Medić",
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
    "Reinier de Ridder",
    "Israel Adesanya",
    "Robert Whittaker",
    "Jared Cannonier",
    "Gregory Rodrigues",
    "Christian Leroy Duncan",
    "Roman Dolidze",
    { name: "Ikram Aliskerov", change: "NR" },
    { name: "Bo Nickal", rank: 15 },
  ],
  "Light Heavyweight": [
    "Magomed Ankalaev",
    "Jiří Procházka",
    "Alex Pereira",
    "Jan Błachowicz",
    "Khalil Rountree Jr.",
    "Jamahal Hill",
    { name: "Azamat Murzakanov", change: 1 },
    { name: "Paulo Costa", rank: 7 },
    "Volkan Oezdemir",
    "Bogdan Guskov",
    "Dominick Reyes",
    "Nikita Krylov",
    "Johnny Walker",
    { name: "Aleksandar Rakić", change: 1 },
    { name: "Alonzo Menifield", change: -1 },
  ],
  Heavyweight: [
    "Ciryl Gane",
    "Alexander Volkov",
    "Sergei Pavlovich",
    "Josh Hokit",
    "Waldo Cortes Acosta",
    "Serghei Spivac",
    "Curtis Blaydes",
    "Rizvan Kuniev",
    "Tyrell Fortune",
    "Ante Delija",
    "Derrick Lewis",
    "Marcin Tybura",
    "Brando Peričić",
    "Valter Walker",
    "Mick Parkin",
  ],
  "Women's Strawweight": [
    "Zhang Weili",
    "Tatiana Suarez",
    "Virna Jandiroba",
    "Yan Xiaonan",
    "Gillian Robertson",
    "Loopy Godinez",
    "Amanda Lemos",
    "Tabatha Ricci",
    "Jéssica Andrade",
    "Amanda Ribas",
    "Fatima Kline",
    "Angela Hill",
    "Denise Gomes",
    "Alexia Thainara",
    "Mizuki",
  ],
  "Women's Flyweight": [
    "Natalia Silva",
    "Manon Fiorot",
    "Alexa Grasso",
    "Erin Blanchfield",
    "Rose Namajunas",
    "Maycee Barber",
    "Jasmine Jasudavicius",
    "Tracy Cortez",
    "Miranda Maverick",
    "Karine Silva",
    "Casey O'Neill",
    "Wang Cong",
    "Eduarda Moura",
    "JJ Aldrich",
    "Gabriella Fernandes",
  ],
  "Women's Bantamweight": [
    "Julianna Peña",
    "Raquel Pennington",
    "Joselyne Edwards",
    "Norma Dumont",
    "Ailin Perez",
    { name: "Yana Santos", change: 1 },
    { name: "Irene Aldana", change: -1 },
    "Macy Chiasson",
    "Luana Santos",
    "Jacqueline Cavalcanti",
    "Karol Rosa",
    "Bia Mesquita",
    "Nora Cornolle",
    "Michelle Montague",
    "Miesha Tate",
  ],
};

const ourRankingOverrides = {
  Flyweight: [
    "Alexandre Pantoja",
    "Manel Kape",
    "Tatsuro Taira",
    "Kyoji Horiguchi",
    "Asu Almabayev",
    "Loneer Kavanagh",
    "Alex Perez",
    "Charles Johnson",
    "Brandon Moreno",
    "Sumudaerji",
    "Brandon Royval",
    "Steve Erceg",
    "Amir Albazi",
    "Mitch Raposo",
    "Kevin Borjas",
  ],
  Bantamweight: [
    "Merab Dvalishvili",
    "Sean O'Malley",
    "Umar Nurmagomedov",
    "Raoni Barcelos",
    "Mario Bautista",
    "Song Yadong",
    "Marcus McGhee",
    "Payton Talbott",
    "David Martinez",
    "Cory Sandhagen",
    "Montel Jackson",
    "Farid Basharat",
    "Aiemann Zahabi",
    "Bryce Mitchell",
    "Deiveson Figueiredo",
  ],
  Featherweight: [
    "Movsar Evloev",
    "Lerone Murphy",
    "Diego Lopes",
    "Jean Silva",
    "Aljamain Sterling",
    "Arnold Allen",
    "Nathaniel Wood",
    "Pat Sabatini",
    "Steve Garcia",
    "Kevin Vallejos",
    "Youssef Zalal",
    "Yair Rodriguez",
    "Melquizael Costa",
    "Jose Delgado",
    "Aaron Pico",
  ],
  Lightweight: [
    "Ilia Topuria",
    "Arman Tsarukyan",
    "Charles Oliveira",
    "Benoit Saint Denis",
    "Max Holloway",
    "Mateusz Gamrot",
    "Quillan Salkilld",
    "Renato Moicano",
    "Paddy Pimblett",
    "Mauricio Ruffy",
    "Tom Nolan",
    "Rafael Fiziev",
    "Manuel Torres",
    "Beneil Dariush",
    "Dan Hooker",
  ],
  Welterweight: [
    "Ian Machado Garry",
    "Carlos Prates",
    "Michael Morales",
    "Sean Brady",
    "Jack Della Maddalena",
    "Kamaru Usman",
    "Gabriel Bonfim",
    "Joaquin Buckley",
    "Belal Muhammad",
    "Daniel Rodriguez",
    "Yaroslav Amosov",
    "Uros Medic",
    "Mike Malott",
    "Leon Edwards",
    "Michael Page",
  ],
  Middleweight: [
    "Khamzat Chimaev",
    "Nassourdine Imavov",
    "Dricus Du Plessis",
    "Anthony Hernandez",
    "Brendan Allen",
    "Joe Pyfer",
    "Gregory Rodrigues",
    "Caio Borralho",
    "Reinier De Ridder",
    "Ikram Aliskerov",
    "Christian Leroy Duncan",
    "Bo Nickal",
    "Israel Adesanya",
    "Jared Cannonier",
    "Roman Kopylov",
  ],
  "Light Heavyweight": [
    "Magomed Ankalaev",
    "Jiri Prochazka",
    "Dominick Reyes",
    "Khalil Rountree Jr.",
    "Paulo Costa",
    "Volkan Oezdemir",
    "Bogdan Guskov",
    "Azamat Murzakanov",
    "Dustin Jacoby",
    "Jan Blachowicz",
    "Navajo Stirling",
    "Alonzo Menifield",
    "Johnny Walker",
    "Jamahal Hill",
    "Ibo Aslan",
  ],
  Heavyweight: [
    "Ciryl Gane",
    "Alex Pereira",
    "Alexander Volkov",
    "Sergei Pavlovich",
    "Josh Hokit",
    "Waldo Cortes-Acosta",
    "Curtis Blaydes",
    "Serghei Spivac",
    "Vitor Petrino",
    "Valter Walker",
    "Brando Pericic",
    "Rizvan Kuniev",
    "Mario Pinto",
    "Mick Parkin",
    "Tyrell Fortune",
  ],
  "Women's Strawweight": [
    "Zhang Weili",
    "Tatiana Suarez",
    "Virna Jandiroba",
    "Gillian Robertson",
    "Denise Gomes",
    "Yan Xiaonan",
    "Tabatha Ricci",
    "Loopy Godinez",
    "Jéssica Andrade",
    "Alexia Thainara",
    "Fatima Kline",
    "Amanda Lemos",
    "Mizuki",
    "Angela Hill",
    "Amanda Ribas",
  ],
  "Women's Flyweight": [
    "Natalia Silva",
    "Manon Fiorot",
    "Erin Blanchfield",
    "Alexa Grasso",
    "Rose Namajunas",
    "Jasmine Jasudavicius",
    "Maycee Barber",
    "Miranda Maverick",
    "Casey O'Neill",
    "Wang Cong",
    "Eduarda Moura",
    "JJ Aldrich",
    "Karine Silva",
    "Tracy Cortez",
    "Gabriella Fernandes",
  ],
  "Women's Bantamweight": [
    "Ailin Perez",
    "Joselyne Edwards",
    "Luana Santos",
    "Yana Santos",
    "Julianna Peña",
    "Norma Dumont",
    "Bia Mesquita",
    "Melissa Croden",
    "Jacqueline Cavalcanti",
    "Raquel Pennington",
    "Michelle Montague",
    "Karol Rosa",
    "Macy Chiasson",
    "Irene Aldana",
    "Daria Zhelezniakova",
  ],
};

const confidenceLevelCopy = {
  fragile: {
    label: "Fragile",
    shortLabel: "Fragile",
    detail: "Small component changes can move this ranking multiple spots.",
  },
  virtual_tie: {
    label: "Virtual tie",
    shortLabel: "Tie",
    detail: "Adjacent final scores are within the model's virtual-tie band.",
  },
  close: {
    label: "Close",
    shortLabel: "Close",
    detail: "The fighter is separated, but still inside a close-score band.",
  },
  clear: {
    label: "Clear separation",
    shortLabel: "Clear",
    detail: "Nearest adjacent score gap is outside the close-score band.",
  },
};

const ourConfidenceOverrides = buildConfidenceOverrides([
  {
    division: "Light Heavyweight",
    level: "fragile",
    fighters: ["Khalil Rountree Jr.", "Bogdan Guskov"],
    detail: "Part of the LHW 5-9 uncertainty band and sensitive to recent-form tuning.",
  },
  {
    division: "Light Heavyweight",
    level: "virtual_tie",
    fighters: ["Paulo Costa", "Volkan Oezdemir", "Jan Blachowicz", "Navajo Stirling"],
    detail: "Adjacent LHW scores are nearly identical, so the exact order is low-confidence.",
  },
  {
    division: "Light Heavyweight",
    level: "close",
    fighters: ["Azamat Murzakanov", "Alonzo Menifield"],
    detail: "Inside a close LHW band, but not as compressed as the virtual-tie slots.",
  },
  {
    division: "Lightweight",
    level: "virtual_tie",
    fighters: [
      "Ilia Topuria",
      "Arman Tsarukyan",
      "Max Holloway",
      "Mateusz Gamrot",
      "Quillan Salkilld",
      "Renato Moicano",
      "Paddy Pimblett",
      "Mauricio Ruffy",
    ],
    detail: "This lightweight cluster is close enough that one-rank movement should not be over-read.",
  },
  {
    division: "Lightweight",
    level: "close",
    fighters: ["Charles Oliveira"],
    detail: "Separated from Arman, but still inside the close-score band.",
  },
  {
    division: "Welterweight",
    level: "virtual_tie",
    fighters: [
      "Ian Machado Garry",
      "Carlos Prates",
      "Sean Brady",
      "Jack Della Maddalena",
      "Kamaru Usman",
      "Joaquin Buckley",
      "Belal Muhammad",
      "Uros Medic",
      "Mike Malott",
    ],
    detail: "The model score gap to an adjacent welterweight is within the virtual-tie threshold.",
  },
  {
    division: "Welterweight",
    level: "close",
    fighters: ["Daniel Rodriguez", "Yaroslav Amosov"],
    detail: "Close-score welterweight ordering; stronger evidence is needed before treating the gap as decisive.",
  },
  {
    division: "Middleweight",
    level: "virtual_tie",
    fighters: [
      "Khamzat Chimaev",
      "Nassourdine Imavov",
      "Anthony Hernandez",
      "Brendan Allen",
      "Caio Borralho",
      "Reinier De Ridder",
    ],
    detail: "Adjacent middleweight scores are inside the virtual-tie threshold.",
  },
  {
    division: "Middleweight",
    level: "close",
    fighters: ["Joe Pyfer", "Gregory Rodrigues"],
    detail: "Close-score middleweight ordering with a narrow adjacent gap.",
  },
  {
    division: "Featherweight",
    level: "fragile",
    fighters: ["Arnold Allen"],
    detail: "Part of the featherweight 3-7 band and sensitive to recent-form tuning.",
  },
  {
    division: "Featherweight",
    level: "virtual_tie",
    fighters: [
      "Lerone Murphy",
      "Diego Lopes",
      "Jean Silva",
      "Aljamain Sterling",
      "Nathaniel Wood",
      "Pat Sabatini",
      "Steve Garcia",
      "Kevin Vallejos",
      "Youssef Zalal",
    ],
    detail: "Featherweight scores are packed tightly enough to treat the exact order as provisional.",
  },
  {
    division: "Featherweight",
    level: "close",
    fighters: ["Yair Rodriguez", "Melquizael Costa"],
    detail: "Close-score featherweight ordering outside the virtual-tie threshold.",
  },
  {
    division: "Women's Flyweight",
    level: "fragile",
    fighters: ["Alexa Grasso"],
    detail: "Part of the women's flyweight 5-8 band and sensitive to recent-form tuning.",
  },
  {
    division: "Women's Flyweight",
    level: "virtual_tie",
    fighters: ["Rose Namajunas", "Jasmine Jasudavicius", "Maycee Barber", "Eduarda Moura", "JJ Aldrich"],
    detail: "Adjacent women's flyweight scores are inside the virtual-tie threshold.",
  },
  {
    division: "Women's Flyweight",
    level: "close",
    fighters: ["Karine Silva", "Tracy Cortez"],
    detail: "Close-score women's flyweight ordering outside the virtual-tie threshold.",
  },
]);

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
    description: "The latest AI-influenced UFC ranking board from your pasted update.",
    updated: "Last updated Saturday, Jun. 27",
    divisions: metaBoardDivisions,
  },
  media: {
    label: "Media",
    eyebrow: "Media panel",
    description: "The current media-panel UFC ranking board from your pasted update.",
    updated: "Last updated Tuesday, Jun. 30",
    divisions: buildRankingSource(mediaRankingOverrides),
  },
};

const sourceOrder = ["ours", "meta", "media"];

const modelUrls = {
  rankings: `${import.meta.env.BASE_URL}model/rankings.json`,
  explanations: `${import.meta.env.BASE_URL}model/explanations.json`,
  summary: `${import.meta.env.BASE_URL}model/summary.json`,
};

const statIconMap = {
  record: Medal,
  wins: Trophy,
  strikes: BarChart3,
  finishes: Crosshair,
  submissions: Swords,
  activity: Activity,
};

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

function seedValue(name, rank, offset = 0) {
  const total = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total + rank * 17 + offset;
}

function buildConfidenceOverrides(groups) {
  return groups.reduce((byDivision, group) => {
    byDivision[group.division] ??= {};
    for (const fighter of group.fighters) {
      byDivision[group.division][fighter] = {
        ...confidenceLevelCopy[group.level],
        level: group.level,
        detail: group.detail ?? confidenceLevelCopy[group.level].detail,
      };
    }
    return byDivision;
  }, {});
}

function getRankingConfidence(source, division, name, isChampion = false) {
  if (source !== "ours" || isChampion) return null;
  return {
    ...confidenceLevelCopy.clear,
    level: "clear",
    ...(ourConfidenceOverrides[division]?.[name] ?? {}),
  };
}

function makeProfile(name, division, rank = 0, isChampion = false, confidence = null) {
  const override = getProfileOverride(name);
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
    scoreLabel: "OctagonRank score",
    score,
    confidence,
    statCards: null,
    modelData: null,
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

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fighterKey(division, fighter) {
  return `${normalizeName(division)}|${normalizeName(fighter)}`;
}

function getProfileOverride(name) {
  if (profileOverrides[name]) return profileOverrides[name];
  const normalizedTarget = normalizeName(name);
  return Object.entries(profileOverrides).find(([overrideName]) => normalizeName(overrideName) === normalizedTarget)?.[1] ?? {};
}

function rankingEntryName(entry) {
  return typeof entry === "string" ? entry : entry?.name ?? "";
}

function rankingEntryChange(entry) {
  return typeof entry === "string" ? null : entry?.change ?? null;
}

function rankingEntryRank(entry, fallbackRank) {
  return typeof entry === "string" ? fallbackRank : entry?.rank ?? fallbackRank;
}

function buildModelSource(modelRankings) {
  if (!modelRankings?.divisions?.length) return rankingSources.ours;

  return {
    label: "Our model",
    eyebrow: `Updated ${modelRankings.rankings_as_of ?? "model"}`,
    description: "OctagonRank model output with fighter scores, confidence bands, and ranking explanations.",
    divisions: modelRankings.divisions.map((division) => ({
      division: division.division,
      champion: division.champion?.fighter_name,
      rankings: (division.rankings ?? []).map((fighter) => fighter.fighter_name),
    })),
  };
}

function buildModelProfileLookup(modelRankings) {
  const lookup = new Map();
  for (const division of modelRankings?.divisions ?? []) {
    if (division.champion) {
      lookup.set(
        fighterKey(division.division, division.champion.fighter_name),
        makeModelProfile(division.champion, division.division),
      );
    }
    for (const fighter of division.rankings ?? []) {
      lookup.set(fighterKey(division.division, fighter.fighter_name), makeModelProfile(fighter, division.division));
    }
  }
  return lookup;
}

function makeModelProfile(fighter, division) {
  const override = getProfileOverride(fighter.fighter_name);
  const displayRank = Number(fighter.display_rank ?? 0);
  const confidence = fighter.score_confidence
    ? {
        level: fighter.score_confidence,
        label: fighter.score_confidence_label || confidenceLevelCopy[fighter.score_confidence]?.label || "Model band",
        shortLabel: confidenceLevelCopy[fighter.score_confidence]?.shortLabel || fighter.score_confidence,
        detail: fighter.score_confidence_detail || confidenceLevelCopy[fighter.score_confidence]?.detail || "",
      }
    : null;
  const totalStrikes = Number(fighter.totals?.sig_strikes_landed ?? 0);
  const submissionAttempts = Number(fighter.totals?.submission_attempts ?? 0);
  const winsList = [
    fighter.best_win?.opponent_name && `Best win: ${fighter.best_win.opponent_name}`,
    ...(fighter.last_five ?? [])
      .filter((fight) => fight.result === "W")
      .slice(0, 4)
      .map((fight) => `${fight.opponent_name} (${fight.method})`),
  ].filter(Boolean);

  return {
    id: `${slug(division)}-${fighter.is_champion ? "champion" : displayRank}-${slug(fighter.fighter_name)}`,
    name: fighter.fighter_name,
    division,
    rank: displayRank,
    isChampion: Boolean(fighter.is_champion),
    record: fighter.record || `${fighter.wins}-${fighter.losses}`,
    wins: Number(fighter.wins ?? 0),
    sigStrikes: totalStrikes,
    koTko: Number(fighter.finishes ?? 0),
    submissions: submissionAttempts,
    scoreLabel: "OctagonRank score",
    score: formatScore(fighter.final_score),
    confidence,
    statCards: [
      { icon: "record", label: "Record", value: fighter.record || `${fighter.wins}-${fighter.losses}` },
      { icon: "wins", label: "Wins", value: fighter.wins },
      { icon: "strikes", label: "Sig. strikes", value: totalStrikes.toLocaleString() },
      { icon: "finishes", label: "Finishes", value: fighter.finishes },
      { icon: "submissions", label: "Sub. attempts", value: submissionAttempts },
      { icon: "activity", label: "Inactive", value: `${formatScore(fighter.months_inactive, 1)}m` },
    ],
    recordLine: fighter.explanation || "Model explanation is not available for this fighter yet.",
    winsList: winsList.length ? winsList : ["No recent win sample exported."],
    method: buildMethodRows(fighter),
    modelData: fighter,
    statsDetail: override.statsDetail,
  };
}

function buildMethodRows(fighter) {
  const positives = (fighter.top_positive_drivers ?? []).slice(0, 4).map((driver) => [
    driver.label,
    meterValue(driver.value),
    impactCopy(driver.value),
  ]);
  const negatives = (fighter.top_negative_drivers ?? []).slice(0, 2).map((driver) => [
    driver.label,
    meterValue(driver.value),
    impactCopy(driver.value),
  ]);
  const policy = (fighter.policy_components ?? []).slice(0, 2).map((component) => [
    component.label,
    meterValue(component.value),
    ruleImpactCopy(component.value),
  ]);

  return [...positives, ...negatives, ...policy].slice(0, 6);
}

function getProfileForBoard({ profileLookup, source, division, name, rank, isChampion }) {
  if (source === "ours") {
    const profile = profileLookup.get(fighterKey(division, name));
    if (profile) return profile;
  }
  return makeProfile(name, division, rank, isChampion, getRankingConfidence(source, division, name, isChampion));
}

function formatScore(value, digits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toFixed(digits);
}

function signed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `${parsed >= 0 ? "+" : ""}${formatScore(parsed, 2)}`;
}

function impactCopy(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "Neutral in this run.";
  const amount = formatScore(Math.abs(parsed), 2);
  return parsed > 0 ? `Pushes the score up ${amount}.` : `Pulls the score down ${amount}.`;
}

function ruleImpactCopy(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "No ranking-rule movement.";
  const amount = formatScore(Math.abs(parsed), 2);
  return parsed > 0 ? `Ranking rule moves the final score up ${amount}.` : `Ranking rule moves the final score down ${amount}.`;
}

function meterValue(value) {
  return Math.max(6, Math.min(100, Math.abs(Number(value) || 0) * 4));
}

function percent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `${(parsed * 100).toFixed(1)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export default function App() {
  const [activeView, setActiveView] = useState("rankings");
  const [rankingSource, setRankingSource] = useState("ours");
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [modelRankings, setModelRankings] = useState(null);
  const [modelSummary, setModelSummary] = useState(null);
  const [modelLoadState, setModelLoadState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    async function loadModelArtifacts() {
      try {
        const [rankingsResponse, summaryResponse] = await Promise.all([
          fetch(modelUrls.rankings),
          fetch(modelUrls.summary),
        ]);
        if (!rankingsResponse.ok) throw new Error(`Could not load ${modelUrls.rankings}`);
        if (!summaryResponse.ok) throw new Error(`Could not load ${modelUrls.summary}`);
        const [rankings, summary] = await Promise.all([rankingsResponse.json(), summaryResponse.json()]);
        if (!cancelled) {
          setModelRankings(rankings);
          setModelSummary(summary);
          setModelLoadState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setModelLoadState("error");
        }
      }
    }
    loadModelArtifacts();
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceCatalog = useMemo(
    () => ({
      ...rankingSources,
      ours: buildModelSource(modelRankings),
    }),
    [modelRankings],
  );
  const profileLookup = useMemo(() => buildModelProfileLookup(modelRankings), [modelRankings]);
  const activeSource = sourceCatalog[rankingSource];

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
              className={activeView === "simulator" ? "nav-tab active" : "nav-tab"}
              type="button"
              onClick={() => {
                setActiveView("simulator");
                setSelectedAthlete(null);
              }}
            >
              Simulator
            </button>
          </nav>
        </header>

        <AnimatePresence mode="popLayout">
          {activeView === "rankings" && !selectedAthlete && (
            <RankingBoard
              key="ranking-board"
              divisions={activeSource.divisions}
              source={rankingSource}
              sourceCatalog={sourceCatalog}
              profileLookup={profileLookup}
              modelLoadState={modelLoadState}
              modelSummary={modelSummary}
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

          {activeView === "methodology" && <MethodologyView key="methodology-view" summary={modelSummary} />}

          {activeView === "simulator" && (
            <SimulatorView key="simulator-view" modelRankings={modelRankings} modelLoadState={modelLoadState} />
          )}
        </AnimatePresence>
      </main>
    </LayoutGroup>
  );
}

function RankingBoard({ divisions, source, sourceCatalog, profileLookup, modelLoadState, modelSummary, onSourceChange, onSelect }) {
  const activeSource = sourceCatalog[source];

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
        <span>
          {activeSource.description}
          {source === "ours" && modelSummary?.rankings_as_of ? ` As of ${modelSummary.rankings_as_of}.` : ""}
          {activeSource.updated ? ` ${activeSource.updated}.` : ""}
        </span>
      </div>

      <div className="source-toolbar" aria-label="Ranking source">
        <span>{source === "ours" && modelLoadState === "loading" ? "Loading model output" : "Compare source"}</span>
        <div>
          {sourceOrder.map((sourceKey) => (
            <button
              key={sourceKey}
              className={source === sourceKey ? "source-button active" : "source-button"}
              type="button"
              onClick={() => onSourceChange(sourceKey)}
            >
              {sourceCatalog[sourceKey].label}
            </button>
          ))}
        </div>
      </div>

      <div className="division-grid">
        {divisions.map((division) => (
          <DivisionColumn
            key={division.division}
            division={division}
            source={source}
            profileLookup={profileLookup}
            onSelect={onSelect}
          />
        ))}
      </div>
    </motion.section>
  );
}

function DivisionColumn({ division, source, profileLookup, onSelect }) {
  const champion = getProfileForBoard({
    profileLookup,
    source,
    division: division.division,
    name: division.champion,
    rank: 0,
    isChampion: true,
  });

  return (
    <section className="division-card" aria-label={`${division.division} rankings`}>
      <button className="champion-block" type="button" onClick={() => onSelect(champion)}>
        <span>{division.division}</span>
        <strong>{division.champion}</strong>
        <small>Champion</small>
      </button>

      <ol className="ranking-list">
        {division.rankings.map((entry, index) => {
          const name = rankingEntryName(entry);
          const change = rankingEntryChange(entry);
          const displayRank = rankingEntryRank(entry, index + 1);
          const athlete = getProfileForBoard({
            profileLookup,
            source,
            division: division.division,
            name,
            rank: displayRank,
            isChampion: false,
          });
          return (
            <li key={athlete.id}>
              <button type="button" onClick={() => onSelect(athlete)}>
                <span>{displayRank}</span>
                <strong className="ranking-name">
                  <b>{name}</b>
                  <RankingMovementBadge change={change} />
                </strong>
                {athlete.confidence && (
                  <em className={`confidence-badge ${athlete.confidence.level}`} title={athlete.confidence.detail}>
                    {athlete.confidence.shortLabel}
                  </em>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RankingMovementBadge({ change }) {
  if (change === null || change === undefined || change === 0) return null;
  const isNew = change === "NR";
  const numericChange = Number(change);
  const direction = isNew ? "new" : numericChange > 0 ? "up" : "down";
  const label = isNew ? "NR" : String(Math.abs(numericChange));
  const title = isNew
    ? "Not previously ranked"
    : `Rank ${numericChange > 0 ? "increased" : "decreased"} by ${Math.abs(numericChange)}`;

  return (
    <em className={`movement-badge ${direction}`} title={title} aria-label={title}>
      <i aria-hidden="true" />
      {label}
    </em>
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
      </div>

      <div className="profile-grid">
        <section className="profile-summary">
          <div className="score-lockup">
            <span>{athlete.scoreLabel ?? "OctagonRank score"}</span>
            <strong>{athlete.score}</strong>
          </div>
          <div className="profile-copy">
            <p>{athlete.recordLine}</p>
            {athlete.confidence && (
              <div className={`profile-confidence ${athlete.confidence.level}`}>
                <strong>{athlete.confidence.label}</strong>
                <span>{athlete.confidence.detail}</span>
              </div>
            )}
          </div>
        </section>

        <section className="stat-grid" aria-label={`${athlete.name} stats`}>
          {(athlete.statCards ?? [
            { icon: "record", label: "Record", value: athlete.record },
            { icon: "wins", label: "Wins", value: athlete.wins },
            { icon: "strikes", label: "Sig strikes", value: athlete.sigStrikes.toLocaleString() },
            { icon: "finishes", label: "TKO/KOs", value: athlete.koTko },
            { icon: "submissions", label: "Submissions", value: athlete.submissions },
            { icon: "activity", label: "Activity", value: athlete.isChampion ? "Baseline" : "Tracked" },
          ]).map((card) => (
            <StatCard key={card.label} icon={statIconMap[card.icon] ?? Activity} label={card.label} value={card.value} />
          ))}
        </section>

        {athlete.modelData && <ModelScoreTape athlete={athlete} />}

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

        {athlete.modelData && <RecentFightPanel fighter={athlete.modelData} />}
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

function ModelScoreTape({ athlete }) {
  const fighter = athlete.modelData;
  const positive = fighter.components?.filter((component) => component.value > 0).slice(0, 5) ?? [];
  const penalties = fighter.penalties?.slice(0, 4) ?? [];
  const policy = fighter.policy_components?.slice(0, 4) ?? [];
  const scoreSteps = [
    { label: "Fight data", value: formatScore(fighter.model_score), note: "Results, opponent level, recent form" },
    { label: "Ranking rules", value: signed(fighter.policy_total), note: "Champions, title context, direct matchups" },
    { label: "Final score", value: formatScore(fighter.final_score), note: "Used to order this division" },
  ];

  return (
    <section className="model-tape" aria-label={`${athlete.name} score breakdown`}>
      <div className="score-breakdown">
        {scoreSteps.map((step) => (
          <article key={step.label}>
            <span>{step.label}</span>
            <strong>{step.value}</strong>
            <p>{step.note}</p>
          </article>
        ))}
      </div>
      <div className="tape-copy">
        <div>
          <div className="section-kicker">Score breakdown</div>
          <h2>How this rank was built</h2>
          <p>
            OctagonRank starts with what happened in the cage: wins, losses, opponent quality, activity, and recent
            form. Then it applies ranking rules for champions, title fights, direct head-to-head results, and close
            calls in the same division.
          </p>
        </div>
        <div className="component-columns">
          <ComponentList title="Why they are high" items={positive} sign="positive" />
          <ComponentList title="What holds them back" items={penalties} sign="negative" />
          <ComponentList title="Ranking rules" items={policy} sign="policy" />
        </div>
      </div>
    </section>
  );
}

function ComponentList({ title, items, sign }) {
  return (
    <article className={`component-list ${sign}`}>
      <h3>{title}</h3>
      {items.length ? (
        items.map((item) => (
          <div key={item.key ?? item.label}>
            <span>{item.label}</span>
            <strong>{sign === "negative" ? `-${formatScore(Math.abs(item.value), 2)}` : signed(item.value)}</strong>
          </div>
        ))
      ) : (
        <p>No major entries.</p>
      )}
    </article>
  );
}

function RecentFightPanel({ fighter }) {
  return (
    <section className="recent-panel">
      <div className="section-kicker">Recent form</div>
      <h2>Last five in model</h2>
      <div className="recent-table">
        {(fighter.last_five ?? []).map((fight) => (
          <article key={`${fight.date}-${fight.opponent_name}`}>
            <span className={fight.result === "W" ? "result-win" : fight.result === "L" ? "result-loss" : ""}>
              {fight.result}
            </span>
            <strong>{fight.opponent_name}</strong>
            <em>{fight.method}</em>
            <b>{signed(fight.rating_change)}</b>
          </article>
        ))}
      </div>
    </section>
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

function SimulatorView({ modelRankings, modelLoadState }) {
  const divisions = modelRankings?.divisions ?? [];
  const [divisionName, setDivisionName] = useState("");
  const activeDivision = divisions.find((division) => division.division === (divisionName || divisions[0]?.division));
  const fighters = activeDivision ? [activeDivision.champion, ...(activeDivision.rankings ?? [])].filter(Boolean) : [];
  const defaultFighterAName = fighters[0]?.fighter_name ?? "";
  const defaultFighterBName = fighters[1]?.fighter_name ?? fighters[0]?.fighter_name ?? "";
  const [fighterAName, setFighterAName] = useState("");
  const [fighterBName, setFighterBName] = useState("");
  const selectedFighterAName = validFighterName(fighterAName, fighters) ?? defaultFighterAName;
  const selectedFighterBName = validFighterName(fighterBName, fighters) ?? defaultFighterBName;

  useEffect(() => {
    if (!activeDivision || !fighters.length) return;
    setFighterAName((current) => validFighterName(current, fighters) ?? defaultFighterAName);
    setFighterBName((current) => validFighterName(current, fighters) ?? defaultFighterBName);
  }, [activeDivision?.division]);

  const prediction = useMemo(() => {
    if (!activeDivision || !selectedFighterAName || !selectedFighterBName || selectedFighterAName === selectedFighterBName) return null;
    return predictBrowserMatchup({
      division: activeDivision,
      fighterAName: selectedFighterAName,
      fighterBName: selectedFighterBName,
    });
  }, [activeDivision, selectedFighterAName, selectedFighterBName]);

  if (modelLoadState === "loading") {
    return (
      <motion.section className="simulator-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="methodology-hero">
          <p>Simulator</p>
          <h1>Loading model</h1>
          <span>Exported rankings are being loaded.</span>
        </div>
      </motion.section>
    );
  }

  if (!divisions.length) {
    return (
      <motion.section className="simulator-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="methodology-hero">
          <p>Simulator</p>
          <h1>No model export</h1>
          <span>Run npm run model:export after generating rankings.</span>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      className="simulator-page"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="methodology-hero">
        <p>Matchup predictor</p>
        <h1>Pick two fighters</h1>
        <span>Win odds and method likelihood from the latest OctagonRank export</span>
      </div>

      <div className="simulator-layout">
        <section className="simulator-controls">
          <label>
            Division
            <select value={activeDivision?.division ?? ""} onChange={(event) => setDivisionName(event.target.value)}>
              {divisions.map((division) => (
                <option key={division.division} value={division.division}>
                  {division.division}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fighter A
            <select value={selectedFighterAName} onChange={(event) => setFighterAName(event.target.value)}>
              {fighters.map((fighter) => (
                <option key={fighter.fighter_name} value={fighter.fighter_name}>
                  {fighter.fighter_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fighter B
            <select value={selectedFighterBName} onChange={(event) => setFighterBName(event.target.value)}>
              {fighters.map((fighter) => (
                <option key={fighter.fighter_name} value={fighter.fighter_name}>
                  {fighter.fighter_name}
                </option>
              ))}
            </select>
          </label>
          <p className="simulator-note">
            This is a matchup read, not a manual result simulator. The model chooses the favorite and likely victory paths.
          </p>
        </section>

        {prediction && (
          <section className="simulation-output">
            <div className="simulation-verdict">
              <span>{prediction.input.division}</span>
              <h2>{prediction.favorite.fighter_name} favored</h2>
              <p>
                OctagonRank gives {prediction.favorite.fighter_name} a {percent(prediction.favorite.winProbability)} chance
                using the current exported score, recent form, opponent quality, dominance, and ranking context.
              </p>
            </div>
            <div className="prediction-split">
              {[prediction.fighterA, prediction.fighterB].map((fighter) => (
                <article
                  key={fighter.fighter_name}
                  className={fighter.fighter_name === prediction.favorite.fighter_name ? "favorite" : ""}
                >
                  <span>{fighter.current_status || (fighter.display_rank ? `Rank #${fighter.display_rank}` : "Contender")}</span>
                  <strong>{fighter.fighter_name}</strong>
                  <b>{percent(fighter.winProbability)}</b>
                  <div className="win-meter" aria-hidden="true">
                    <i style={{ width: `${fighter.winProbability * 100}%` }} />
                  </div>
                </article>
              ))}
            </div>

            <div className="method-probability-grid">
              <article className="method-leader">
                <span>Most likely path</span>
                <strong>{prediction.methodOutcomes[0].label}</strong>
                <b>{percent(prediction.methodOutcomes[0].probability)}</b>
              </article>
              <article>
                <span>Score gap</span>
                <strong>{formatScore(Math.abs(prediction.ratingGap), 1)}</strong>
                <p>{prediction.ratingGap >= 0 ? prediction.fighterA.fighter_name : prediction.fighterB.fighter_name} has the stronger matchup score.</p>
              </article>
              <article>
                <span>Method estimate</span>
                <strong>Prototype</strong>
                <p>Method odds come from finish rate, knockdowns, takedowns, submission attempts, control time, and dominance.</p>
              </article>
            </div>

            <div className="method-outcome-list">
              {prediction.methodOutcomes.slice(0, 6).map((outcome) => (
                <article key={outcome.label}>
                  <span>{outcome.label}</span>
                  <div className="method-probability-meter" aria-hidden="true">
                    <i style={{ width: `${outcome.probability * 100}%` }} />
                  </div>
                  <strong>{percent(outcome.probability)}</strong>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </motion.section>
  );
}

function validFighterName(name, fighters) {
  return fighters.some((fighter) => fighter.fighter_name === name) ? name : null;
}

function predictBrowserMatchup({ division, fighterAName, fighterBName }) {
  const fighters = [division.champion, ...(division.rankings ?? [])].filter(Boolean);
  const fighterA = fighters.find((fighter) => fighter.fighter_name === fighterAName);
  const fighterB = fighters.find((fighter) => fighter.fighter_name === fighterBName);
  if (!fighterA || !fighterB) return null;

  const ratingA = predictionRating(fighterA);
  const ratingB = predictionRating(fighterB);
  const fighterAWinProbability = expectedScore(ratingA, ratingB);
  const fighterBWinProbability = 1 - fighterAWinProbability;
  const fighterAWithPrediction = {
    ...fighterA,
    predictionRating: ratingA,
    winProbability: fighterAWinProbability,
    methodMix: methodMixForFighter(fighterA),
  };
  const fighterBWithPrediction = {
    ...fighterB,
    predictionRating: ratingB,
    winProbability: fighterBWinProbability,
    methodMix: methodMixForFighter(fighterB),
  };
  const favorite =
    fighterAWithPrediction.winProbability >= fighterBWithPrediction.winProbability
      ? fighterAWithPrediction
      : fighterBWithPrediction;
  const methodOutcomes = [
    ...methodOutcomesFor(fighterAWithPrediction),
    ...methodOutcomesFor(fighterBWithPrediction),
  ].sort((a, b) => b.probability - a.probability);

  return {
    input: { division: division.division },
    favorite,
    fighterA: fighterAWithPrediction,
    fighterB: fighterBWithPrediction,
    ratingGap: round(ratingA - ratingB, 2),
    methodOutcomes,
  };
}

function predictionRating(fighter) {
  return Number(fighter.final_score ?? fighter.model_score ?? fighter.base_rating ?? 1500);
}

function methodMixForFighter(fighter) {
  const totals = fighter.totals ?? {};
  const fights = Math.max(1, Number(fighter.wins ?? 0) + Number(fighter.losses ?? 0));
  const wins = Math.max(1, Number(fighter.wins ?? 0));
  const finishRate = clamp(Number(fighter.finishes ?? 0) / wins, 0.12, 0.72);
  const knockdownsPerFight = Number(totals.knockdowns ?? 0) / fights;
  const sigStrikesPerFight = Number(totals.sig_strikes_landed ?? 0) / fights;
  const takedownsPerFight = Number(totals.takedowns_landed ?? 0) / fights;
  const submissionAttemptsPerFight = Number(totals.submission_attempts ?? 0) / fights;
  const controlPerFight = Number(totals.control_seconds ?? 0) / fights;
  const dominanceSignal = Number(fighter.average_dominance ?? 50) / 100;
  const roundControlSignal = Number(fighter.average_round_dominance ?? 50) / 100;
  const koSignal = 0.38 + knockdownsPerFight * 0.22 + sigStrikesPerFight / 170 + dominanceSignal * 0.2;
  const submissionSignal =
    0.28 + takedownsPerFight * 0.08 + submissionAttemptsPerFight * 0.16 + controlPerFight / 1800 + roundControlSignal * 0.2;
  const koShare = clamp(koSignal / Math.max(0.01, koSignal + submissionSignal), 0.24, 0.76);
  const decision = round(1 - finishRate, 4);
  const koTko = round(finishRate * koShare, 4);
  const submission = round(Math.max(0, 1 - decision - koTko), 4);

  return {
    decision,
    koTko,
    submission,
  };
}

function methodOutcomesFor(fighter) {
  return [
    {
      label: `${fighter.fighter_name} by decision`,
      probability: round(fighter.winProbability * fighter.methodMix.decision, 4),
    },
    {
      label: `${fighter.fighter_name} by KO/TKO`,
      probability: round(fighter.winProbability * fighter.methodMix.koTko, 4),
    },
    {
      label: `${fighter.fighter_name} by submission`,
      probability: round(fighter.winProbability * fighter.methodMix.submission, 4),
    },
  ];
}

function MethodologyView({ summary }) {
  const methodEntries = Object.entries(summary?.methodology ?? {}).slice(0, 12);
  const backtest = summary?.backtest_summary;

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
        <h1>How it ranks fighters</h1>
        <span>{summary?.rankings_as_of ? `Model data through ${summary.rankings_as_of}` : "Static model export"}</span>
      </div>

      <div className="methodology-layout">
        <section className="formula-card">
          <div className="formula-topline">
            <span>Status</span>
            <strong>v0.8</strong>
          </div>
          <h2>Fight results first, ranking rules second.</h2>
          <p>
            OctagonRank starts with wins, losses, opponent quality, activity, and fight stats. Then it applies a few
            public ranking rules for champions, direct matchups, and recent title context.
          </p>
          <div className="formula-box">
            <span>Technical shape</span>
            <code>
              final_score = model_score + current_snapshot + title_context + head_to_head + champion_guard
            </code>
          </div>
          {backtest && (
            <div className="method-metrics">
              <article>
                <span>Backtest</span>
                <strong>{percent(backtest.accuracy)}</strong>
              </article>
              <article>
                <span>Validation</span>
                <strong>{formatScore(backtest.validation_score, 2)}</strong>
              </article>
              <article>
                <span>Fights</span>
                <strong>{backtest.fights}</strong>
              </article>
            </div>
          )}
        </section>

        <section className="method-draft-grid" aria-label="Planned methodology sections">
          {(methodEntries.length ? methodEntries : methodDraft.map((item) => [item.title, item.body])).map(([key, body]) => (
            <article key={key}>
              <span>Ranking signal</span>
              <h3>{key.replaceAll("_", " ")}</h3>
              <p>{body}</p>
            </article>
          ))}
        </section>
      </div>
    </motion.section>
  );
}
