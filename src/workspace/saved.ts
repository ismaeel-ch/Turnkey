/* The recordings of every saved build, loaded on demand by loadSaved() in catalog.ts. Importing them fills REC. */
import './builds';
import './quests';
import './samples';
import './expenses';
import { REC } from './registry';

export const savedCount = () => Object.keys(REC).length;
