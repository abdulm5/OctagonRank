# OctagonRank

OctagonRank is a React-based UFC rankings prototype focused on making fighter rankings more transparent. The app presents a UFC-style rankings board, compares multiple ranking sources, and lets users open a fighter profile without leaving the page.

## Current Features

- Men's division rankings laid out in a UFC-inspired board format
- Toggle between three ranking sources:
  - Our model
  - UFC Meta rankings
  - Media rankings
- Animated in-page fighter profile view
- Fighter profile summary with record, wins, significant strikes, TKO/KO wins, submissions, and activity status
- Score explanation panel showing the ranking signals used for selected prototype fighters
- Detailed stat panel for Benoit Saint Denis, including striking accuracy, takedown accuracy, strike targets, strike positions, and win method breakdown
- Methodology and audit pages with draft placeholder content

## Tech Stack

- React
- Vite
- Framer Motion
- Lucide React
- CSS

## Running Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Project Status

This is an early frontend prototype. Ranking data and fighter stats are currently stored directly in the React code. The methodology content is not final and is marked as placeholder where appropriate in the app.
