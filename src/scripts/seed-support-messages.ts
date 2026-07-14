#!/usr/bin/env bun
// Seed the supportMessages collection with the initial rotation set.
// Idempotent — messages are upserted by _id (a stable slug per row).
//
// Usage:
//   bun run src/scripts/seed-support-messages.ts

import { connectToDatabase, disconnectFromDatabase } from '../db/index';
import { createIndexes } from '../db/indexes';
import { getCollections } from '../db/collections';
import type { SupportMessage } from '../schemas/supportMessage.schema';

type SeedRow = Omit<SupportMessage, 'createdAt' | 'updatedAt'>;

const SEEDS: SeedRow[] = [
  {
    _id: 'seed-general-01',
    category: 'general',
    i18n: {
      en: 'Whatever you feel today is valid. There is no right way to walk this path.',
      de: 'Was auch immer du heute fühlst, ist in Ordnung. Es gibt keinen richtigen Weg für diesen Weg.',
    },
    weight: 20,
    isActive: true,
  },
  {
    _id: 'seed-general-02',
    category: 'general',
    i18n: {
      en: 'Rest is not a reward you have to earn — it is fuel your body needs.',
      de: 'Ruhe ist keine Belohnung, die du dir verdienen musst — sie ist Treibstoff für deinen Körper.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-general-03',
    category: 'general',
    i18n: {
      en: 'You are more than any single outcome. You are the one showing up, again.',
      de: 'Du bist mehr als jedes einzelne Ergebnis. Du bist die Person, die immer wieder auftaucht.',
    },
    weight: 10,
    isActive: true,
  },
  {
    _id: 'seed-before-01',
    category: 'before_treatment',
    i18n: {
      en: 'Preparation days can feel long. Try one small kindness to yourself today.',
      de: 'Vorbereitungstage können lang sein. Gönn dir heute eine kleine Freundlichkeit.',
    },
    weight: 10,
    isActive: true,
  },
  {
    _id: 'seed-stim-01',
    category: 'during_stimulation',
    phase: 'stimulation',
    i18n: {
      en: 'Your body is doing quiet, complicated work right now. That is enough.',
      de: 'Dein Körper leistet gerade stille, komplizierte Arbeit. Das ist genug.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-stim-02',
    category: 'during_stimulation',
    phase: 'stimulation',
    i18n: {
      en: 'Bloating, mood swings, tiredness — none of that means anything is wrong with you.',
      de: 'Blähungen, Stimmungsschwankungen, Müdigkeit — nichts davon bedeutet, dass etwas mit dir nicht stimmt.',
    },
    weight: 10,
    isActive: true,
  },
  {
    _id: 'seed-retrieval-01',
    category: 'before_retrieval',
    phase: 'retrieval',
    i18n: {
      en: 'The day is coming. Whatever the number, it will not be a measure of your worth.',
      de: 'Der Tag rückt näher. Egal wie die Zahl ausfällt — sie ist kein Maß für deinen Wert.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-transfer-01',
    category: 'before_transfer',
    phase: 'transfer',
    i18n: {
      en: 'Take a breath. You have done everything within your power to be here.',
      de: 'Atme durch. Du hast alles getan, was in deiner Macht steht, um hier zu sein.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-tww-01',
    category: 'two_week_wait',
    phase: 'two_week_wait',
    i18n: {
      en: 'The waiting is the hardest work. Distraction is not denial — it is survival.',
      de: 'Das Warten ist die härteste Arbeit. Ablenkung ist keine Verdrängung — sie ist Überleben.',
    },
    weight: 20,
    isActive: true,
  },
  {
    _id: 'seed-tww-02',
    category: 'two_week_wait',
    phase: 'two_week_wait',
    i18n: {
      en: 'Every symptom, or none — nothing you feel right now can tell you the answer yet.',
      de: 'Jedes Symptom oder gar keins — nichts, was du gerade fühlst, kann dir die Antwort schon verraten.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-tww-03',
    category: 'two_week_wait',
    phase: 'two_week_wait',
    i18n: {
      en: 'Kind foods, gentle walks, softer plans. That is enough for today.',
      de: 'Sanftes Essen, leichte Spaziergänge, sanftere Pläne. Das ist genug für heute.',
    },
    weight: 10,
    isActive: true,
  },
  {
    _id: 'seed-waiting-01',
    category: 'waiting_results',
    phase: 'outcome',
    i18n: {
      en: 'A result day does not define you. Give yourself somewhere soft to land, either way.',
      de: 'Ein Ergebnistag definiert dich nicht. Schaffe dir einen sanften Ort zum Landen — so oder so.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-difficult-01',
    category: 'after_difficult',
    i18n: {
      en: 'Grief and hope can live in the same day. Neither cancels the other.',
      de: 'Trauer und Hoffnung können am selben Tag existieren. Keins hebt das andere auf.',
    },
    weight: 15,
    isActive: true,
  },
  {
    _id: 'seed-difficult-02',
    category: 'after_difficult',
    i18n: {
      en: 'You do not owe anyone a plan for what comes next. Rest first.',
      de: 'Du schuldest niemandem einen Plan für das, was als Nächstes kommt. Ruh dich erst aus.',
    },
    weight: 10,
    isActive: true,
  },
];

async function main() {
  const db = await connectToDatabase();
  await createIndexes(db);
  const now = new Date().toISOString();

  try {
    const col = getCollections().supportMessages;
    let inserted = 0;
    let updated = 0;
    for (const seed of SEEDS) {
      const result = await col.updateOne(
        { _id: seed._id },
        {
          $set: { ...seed, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
      if (result.upsertedCount) inserted++;
      else if (result.modifiedCount) updated++;
    }
    console.log(`Support messages seeded: ${inserted} inserted, ${updated} updated (total ${SEEDS.length}).`);
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
