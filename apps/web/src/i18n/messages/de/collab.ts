import type { Translation } from '../../index.ts';

export default {
  others: { one: '{count} weitere Person sieht sich diesen Datensatz an', other: '{count} weitere Personen sehen sich diesen Datensatz an' },
  viewing: '{name} sieht sich diesen Datensatz an',
  editing: '{name} bearbeitet diesen Datensatz',
  editingField: '{name} bearbeitet {field}',
  more: { one: '{count} weitere Person', other: '{count} weitere Personen' },
  someone: 'Jemand',
  changed: '{name} hat diesen Datensatz gerade geändert. Die Änderungen an Feldern, die Sie nicht bearbeitet haben, werden hier angezeigt.',
  changedEdited: 'Dabei wurden auch Felder geändert, die Sie bearbeitet haben: {fields}. Beim Speichern wählen Sie aus, welche Werte beibehalten werden.',
  conflict: {
    title: 'Jemand anderes hat dieselben Felder geändert',
    message: 'Diese Felder wurden geändert, nachdem Sie mit der Bearbeitung begonnen haben. Wählen Sie aus, welche Werte beibehalten werden sollen.',
    theirValue: 'Gespeicherter Wert',
    yourValue: 'Ihr Wert',
    by: '{name}, {time}',
    useTheirs: 'Gespeicherte Werte übernehmen',
    saveMine: 'Meine Werte trotzdem speichern',
    rebased: 'Das Formular zeigt jetzt die gespeicherten Werte. Prüfen Sie es und speichern Sie erneut.',
  },
  fieldConflict: '{name} hat dieses Feld {time} geändert:',
  useTheirs: 'Diesen behalten',
  saveMine: 'Meinen speichern',
} satisfies Translation['collab'];
