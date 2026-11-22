import { plural } from '../../plural.ts';

/** Setup → Object Manager → Page Layouts: drag-and-drop editor of record pages. */
export default {
  /** {object}: object label, e.g. "Account". */
  intro: 'Arrange the fields, sections and related lists of {object} record pages. Give teams their own layout by assigning it to their roles; everyone else sees the default layout.',
  layout: 'Layout',
  newLayout: 'New layout',
  newLayoutTitle: 'New page layout',
  /** Select in the "New layout" dialog: the layout copied as a starting point. */
  startFrom: 'Start from',
  /** Name suggested for a copy of a layout. */
  copyName: '{name} (copy)',
  create: 'Create',
  /** Badge on the default layout. */
  default: 'Default',
  /** Badge on a layout created in the editor but not saved yet. */
  notSaved: 'Not saved',
  name: 'Layout name',
  isDefault: 'Default layout',
  isDefaultHelp: 'Shown to roles without a layout of their own.',
  defaultLocked: 'This is the default layout. To change that, make another layout the default.',
  roles: 'Roles',
  rolesHelp: 'People with these roles see this layout.',
  /** Next to a role that another layout already uses. {layout}: that layout's name. */
  roleTaken: 'Uses “{layout}”',
  rolesNone: 'There are no roles yet.',
  /** Shown above the editor. */
  dragHint: 'Drag fields between the list of fields and the sections, or use the menu on each field.',

  highlights: {
    title: 'Highlights',
    help: plural({ one: 'Up to {count} field shown in the record header.', other: 'Up to {count} fields shown in the record header.' }),
    empty: 'Drag fields here to show them in the record header.',
    full: plural({ one: 'The header shows at most {count} field.', other: 'The header shows at most {count} fields.' }),
    addLabel: 'Add a highlight field',
    add: 'Add field…',
    remove: 'Remove {field} from the highlights',
    moveLeft: 'Move {field} left',
    moveRight: 'Move {field} right',
  },

  sections: {
    add: 'Add section',
    /** Title of a section added in the editor. */
    newTitle: 'New Section',
    titleLabel: 'Section title',
    /** Placeholder of an empty section title: what record pages show instead, e.g. "Account Information". */
    untitled: '{object} Information',
    columns: 'Columns',
    oneColumn: '1 column',
    twoColumns: '2 columns',
    moveUp: 'Move section “{section}” up',
    moveDown: 'Move section “{section}” down',
    remove: 'Remove section “{section}”',
    empty: 'Drag fields here',
    max: plural({ one: 'A layout has at most {count} section.', other: 'A layout has at most {count} sections.' }),
  },

  fields: {
    title: 'Fields',
    help: 'Fields that are not on the layout.',
    search: 'Search fields',
    searchPlaceholder: 'Search fields…',
    allPlaced: 'Every field is on the layout.',
    noMatches: 'No fields match.',
    required: 'Required',
    /** Required fields cannot be removed: people need them to create records. */
    requiredLocked: 'Required fields stay on the layout.',
    sensitive: 'Visible only to roles that can view sensitive fields',
    menu: 'Actions for {field}',
    /** Button on a field that is not on the layout. {section}: title of the first section. */
    add: 'Add {field} to “{section}”',
    moveUp: 'Move up',
    moveDown: 'Move down',
    /** {section}: section title. */
    moveTo: 'Move to “{section}”',
    addToHighlights: 'Add to highlights',
    removeFromHighlights: 'Remove from highlights',
    removeFromLayout: 'Remove from layout',
  },

  related: {
    title: 'Related lists',
    help: 'Lists of related records shown on record pages, in this order.',
    empty: 'No related lists on this layout.',
    available: 'Available related lists',
    allAdded: 'Every related list is on the layout.',
    none: 'No other objects look up to {object}.',
    add: 'Add {list}',
    remove: 'Remove {list}',
    moveUp: 'Move {list} up',
    moveDown: 'Move {list} down',
  },

  unsaved: 'Unsaved changes',
  save: 'Save layout',
  saved: 'Layout saved',
  discard: 'Discard changes',
  delete: 'Delete layout',
  deleteTitle: 'Delete “{name}”?',
  deleteMessage: 'People with its roles will see the default layout.',
  deleted: 'Layout deleted',
  problems: {
    name: 'Enter a layout name.',
    sections: 'Add at least one section.',
  },
};
