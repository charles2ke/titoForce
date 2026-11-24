import { plural } from '../../plural.ts';

/** Setup → Translations: administrators translate the labels of the organization's metadata. */
export default {
  title: 'Translations',
  subtitle: 'Translate the labels of objects, fields, picklist values, page layout sections and apps. People see them in the language they use titoForce in.',
  /** English is the source language of every label, so it is not in the language list. */
  englishBase: 'Labels are defined in English. To change an English label, rename it where it is defined in Setup.',
  language: 'Language',
  type: 'Type',
  types: {
    all: 'All types',
    object: 'Objects',
    field: 'Fields',
    picklist: 'Picklist values',
    layout: 'Page layout sections',
    app: 'Apps',
  },
  /** Badge on each row: what kind of label it is (singular). */
  typeBadge: {
    object: 'Object',
    field: 'Field',
    picklist: 'Picklist value',
    layout: 'Section',
    app: 'App',
  },
  object: 'Object',
  allObjects: 'All objects',
  show: 'Show',
  statuses: {
    all: 'All labels',
    /** Labels with neither a translation saved here nor a built-in one: people see English. */
    missing: 'Not translated',
    custom: 'Translated here',
    /** titoForce ships translations of the standard labels; administrators can replace them. */
    builtIn: 'Built-in translations',
  },
  search: 'Search labels',
  searchPlaceholder: 'Search labels…',
  /** {count}: number of labels; {done}: how many of them are translated (here or built in). */
  progress: plural({ one: '{done} of {count} label translated', other: '{done} of {count} labels translated' }),
  columns: {
    label: 'Label in English',
    type: 'Type',
    /** {language}: language name, e.g. "Español". */
    translation: 'Translation ({language})',
  },
  /** Accessible name of a translation input. */
  translationOf: 'Translation of “{label}”',
  /** Under an empty input whose label has a built-in translation (shown as the placeholder). */
  builtInHint: 'Built-in translation. Type to replace it.',
  /** Button next to a translation saved here: remove it so the built-in translation or English applies again. */
  reset: 'Remove translation',
  noMatches: 'No labels match these filters.',
  unsaved: plural({ one: '{count} unsaved change', other: '{count} unsaved changes' }),
  save: 'Save translations',
  discard: 'Discard',
  saved: plural({ one: '{count} translation saved', other: '{count} translations saved' }),
};
