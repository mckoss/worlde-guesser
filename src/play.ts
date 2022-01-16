import { prompt } from './prompt.js';
import { readFile } from 'fs/promises';
import { exit } from 'process';

import { Wordle, isValidClue } from './wordle.js';
import { analyze } from './wordle-guess.js';

const dict = JSON.parse(await readFile('public/data/words.json', 'utf8')) as string[];
const soln = JSON.parse(await readFile('public/data/solutions.json', 'utf8')) as string[];

const wordle = new Wordle(dict);
let subset = new Set(soln);

console.log("Let's play Wordle!\n");
console.log("When prompted for a clue type a 5-letter string of the form:");
console.log("X - not in answer (Gray in Wordle)");
console.log("! - correct letter in correct position (Green in Wordle)");
console.log("? - correct letter in wrong position (Yellow in Wordle)");

// Note optimal from expected size (that would be 'roate', 60.4 vs 61) - but
// has better max size (168 vs 195).
let guess = 'raise';
console.log(`I guess '${guess}.'`);
let guesses = 1;

while (true) {
  const clue = (await prompt("Clue")).toUpperCase();
  if (!isValidClue(clue)) {
    console.log("That's not a valid clue.");
    continue;
  }

  if (clue === '!!!!!') {
    console.log(`I win. It took me ${guesses} guesses.`);
    exit(0);
  }

  const words = wordle.possibleWords(guess, clue, subset);
  console.log(`I've narrowed it down to ${words.length} words.`);
  console.log(`One of: ${words.join(', ')}`);

  subset = new Set(words);

  const bestGuess = analyze(dict, 1, subset);
  console.log(JSON.stringify(bestGuess));

  guess = bestGuess[0].guess;
  guesses++;

  console.log(`I going to guess '${guess}', now.`);
  console.log("Because that will narrow it down to no more than " +
    `${bestGuess[0].maxSet.size} words in the worst case.`);
}
