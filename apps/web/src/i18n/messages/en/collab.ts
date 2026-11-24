import { plural } from '../../plural.ts';

/** Real-time collaboration on record pages: who else is there, and edits that cross. */
export default {
  /** Accessible label of the avatars of the other people on a record page. */
  others: plural({ one: '{count} other person on this record', other: '{count} other people on this record' }),
  /** Tooltip of the avatar of someone looking at the record. */
  viewing: '{name} is viewing',
  /** Someone has the record's edit form open. */
  editing: '{name} is editing',
  /** {field}: field label. */
  editingField: '{name} is editing {field}',
  /** Tooltip of "+2" after the avatars shown. */
  more: plural({ one: '{count} more person', other: '{count} more people' }),
  /** Instead of the name of an unknown user or an automation. */
  someone: 'Someone',
  /** In an edit form when someone else saves the record. {name}: who saved. */
  changed: '{name} just changed this record. Their changes to fields you have not edited are shown here.',
  /** Follows "changed" when they also changed fields this user edited. {fields}: list of field labels. */
  changedEdited: 'They also changed {fields}, which you edited. When you save, you choose which values to keep.',
  conflict: {
    title: 'Someone else changed the same fields',
    message: 'These fields were changed after you started editing. Choose which values to keep.',
    theirValue: 'Their value',
    yourValue: 'Your value',
    /** Under their value. {name}: who changed the field; {time}: relative time, e.g. "2 minutes ago". */
    by: '{name}, {time}',
    useTheirs: 'Use their values',
    saveMine: 'Save mine anyway',
    /** After "Use their values". */
    rebased: 'The form now shows their values. Review it and save again.',
  },
  /** Editing one field of the record page that someone else changed meanwhile. {name}: who; {time}: relative time. */
  fieldConflict: '{name} changed this field {time}:',
  useTheirs: 'Use theirs',
  saveMine: 'Save mine',
};
