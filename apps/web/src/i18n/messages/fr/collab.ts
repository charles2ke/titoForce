import type { Translation } from '../../index.ts';

export default {
  others: { one: '{count} autre personne sur cet enregistrement', other: '{count} autres personnes sur cet enregistrement' },
  viewing: '{name} consulte cet enregistrement',
  editing: '{name} modifie cet enregistrement',
  editingField: '{name} modifie le champ {field}',
  more: { one: '{count} autre personne', other: '{count} autres personnes' },
  someone: 'Quelqu’un',
  changed: '{name} vient de modifier cet enregistrement. Les champs que vous n’avez pas modifiés affichent désormais ses valeurs.',
  changedEdited: 'Ses changements portent aussi sur {fields}, tout comme les vôtres. Lors de l’enregistrement, vous choisirez les valeurs à conserver.',
  conflict: {
    title: 'Quelqu’un d’autre a modifié les mêmes champs',
    message: 'Ces champs ont changé depuis que vous avez commencé vos modifications. Choisissez les valeurs à conserver.',
    theirValue: 'Sa valeur',
    yourValue: 'Votre valeur',
    by: '{name}, {time}',
    useTheirs: 'Utiliser ses valeurs',
    saveMine: 'Enregistrer quand même mes valeurs',
    rebased: 'Le formulaire affiche maintenant ses valeurs. Vérifiez-le, puis enregistrez à nouveau.',
  },
  fieldConflict: '{name} a modifié ce champ {time} :',
  useTheirs: 'Utiliser sa valeur',
  saveMine: 'Enregistrer ma valeur',
} satisfies Translation['collab'];
