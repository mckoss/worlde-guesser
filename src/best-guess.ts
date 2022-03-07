import { readFile } from 'fs/promises';
import { exit } from 'process';
import { analyze, telemetry, rankExpected, rankStat, rankWorst } from './wordle-guess.js';
import { Wordle } from './wordle.js';

import { MultiTrial } from './best-guess-message.js';

import { Pool } from './worker-pool.js';

const dict: string[] = JSON.parse(await readFile('data/words.json', 'utf8'));
const solutions = new Set(JSON.parse(await readFile('data/solutions.json', 'utf8')) as string[]);

let multi = 1;
let table: string[] | undefined;

const NUM_PROCS = 8;

async function main(args: string[]) {
  let rankFunction = rankStat;
  let hardMode = false;
  let showTop = false;
  let top = 10;

  for (const option of args) {
    if (option.startsWith('--')) {
      const [, name, value] = option.match(/^--([^=]+)=?(.*)$/) || [];
      if (name === 'help') {
        help();
      } else if (name === 'expected') {
        rankFunction = rankExpected;
      } else if (name === 'worst') {
        rankFunction = rankWorst;
      } else if (name === 'hard') {
        hardMode = true;
      } else if (name === 'telemetry') {
        telemetry(true);
      } else if (name === 'top') {
        showTop = true;
        if (value !== '') {
          top = parseInt(value);
          if (isNaN(top) || top < 1) {
            help(`Invalid top value: ${value}`);
          }
        }
      } else if (name === 'multi') {
        if (value === '') {
          multi = 2;
        } else {
          multi = parseInt(value);
          if (isNaN(multi) || multi < 1) {
            help(`Invalid multi value: ${value}`);
          }
        }
      } else if (name === 'table') {
        table = value.split(',');
        for (const guess of table) {
          if (guess.length !== 5) {
            help(`Invalid table value - 5-letter word guesses: ${value}`);
          }
        }
      } else {
        help(`Unknown option: ${option}`);
      }
    } else {
      help(`Invalid argument: ${option}`);
    }
  }

  if (multi === 2) {
    await twoWords();
    return;
  }

  if (table !== undefined) {
    outputTable(table);
    return;
  }

  const guesses = analyze(dict, top, solutions, rankFunction, hardMode);
  console.log(`Optimal first guess is '${guesses[0].guess}' with at most ` +
    `${guesses[0].maxSet.size} words remaining`);
  if (showTop) {
    console.log(guesses);
  }
}

// Try all combinations of first two guesses to determine:
// - Lowest expected word count.
// - Smallest maximum word count.
// - List of words remaining.
// Start out using smaller solution dictionary.
async function twoWords() {
  let count = 0;
  let lastPercent = 0;
  const totalCombinations = (solutions.size * (solutions.size + 1)) / 2;

  const pool = new Pool<string[], MultiTrial>(NUM_PROCS, './node/best-guess-worker.js', (trial) => {
    if (bestExpected === undefined || trial.expected < bestExpected.expected) {
      bestExpected = trial;
      console.log(`${count}. New best expected: ${trialOutput(bestExpected)}`);
    }
    if (bestMax === undefined || trial.max < bestMax.max) {
      bestMax = trial;
      console.log(`${count}. New best max: ${trialOutput(bestMax)}`);
    }
    count++;
    const percent = Math.round(count / totalCombinations * 100);
    if (percent > lastPercent) {
      lastPercent = percent;
      console.log(`${percent}% complete ...`);
    }
  });

  const dict = Array.from(solutions);

  let bestExpected: MultiTrial | undefined;
  let bestMax: MultiTrial | undefined;

  for (let i = 0; i < dict.length; i++) {
    const guesses = [dict[i]];
    for (let j = i + 1; j < dict.length; j++) {
      guesses[1] = dict[j];
      await pool.call(guesses);
    }
  }

  await pool.complete();

  outputGuesses('Min-Max', bestMax!);
  outputGuesses('Expected', bestExpected!);
}

function trialOutput(trial: MultiTrial): string {
  return JSON.stringify(trial, null, 2);
}

function outputGuesses(title: string, trial: MultiTrial) {
  console.log(`${title}: ${trial.guesses.join(', ')}\n`);
  console.log(`  Expected: ${trial.expected}\n`);
  console.log(`  Max: ${trial.max}\n`);
}

function outputTable(guesses: string[]) {
  const table = guessTable(guesses);

  for (const row of table) {
    console.log(`  ${row.pattern}: ${row.words.join(' ')}`);
  }
}

function guessTable(guesses: string[]) : { pattern: string, words: string[] }[] {
  const wordle = new Wordle(dict);
  const words = new Map<string, string[]>();

  for (const word of solutions) {
    wordle.setWordFast(word);
    const key = guesses.map(guess => wordle.makeGuess(guess)).join('-');
    if (!words.has(key)) {
      words.set(key, []);
    }
    words.get(key)!.push(word);
  }

  const patterns = Array.from(words.keys());
  patterns.sort();

  return patterns.map(pattern => { return { pattern, words: words.get(pattern)! } });
}

function help(msg?: string) {
  if (msg) {
    console.error(msg + '\n');
  }

  console.log(`
Evaluate the best first word for a Wordle game.

Usage:
  best-guess [options]

Options:
  --help                Show this help message.
  --hard                In hard mode - only guess words that remain possible.
  --expected            Rank guesses by expected size of partitions.
  --worst               Rank guesses by worst-case size of partitions.
  --telemetry           Sample words during processing.
  --top=N               Show the top N guesses (default 10).
  --multi=N             Optimize for combination of N words (default 2).
  --table=guess1,guess2 Show the solution table for a multi-guess solution.
`);

  exit(msg === undefined ? 0 : 1);
}

main(process.argv.slice(2));
