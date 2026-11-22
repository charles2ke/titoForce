import type { Translation } from '../../index.ts';

export default {
  others: { one: 'Otra persona en este registro', other: 'Otras {count} personas en este registro' },
  viewing: '{name} está viendo el registro',
  editing: '{name} está editando el registro',
  editingField: '{name} está editando el campo {field}',
  more: { one: '{count} persona más', other: '{count} personas más' },
  someone: 'Alguien',
  changed: '{name} acaba de modificar este registro. Aquí se muestran los cambios que ha hecho en los campos que usted no ha editado.',
  changedEdited: 'También ha modificado {fields}, que usted ha editado. Al guardar, podrá elegir qué valores conservar.',
  conflict: {
    title: 'Otra persona ha modificado los mismos campos',
    message: 'Estos campos se han modificado después de que empezara a editar. Elija qué valores conservar.',
    theirValue: 'Valor de la otra persona',
    yourValue: 'Su valor',
    by: '{name}, {time}',
    useTheirs: 'Usar los valores de la otra persona',
    saveMine: 'Guardar los míos de todos modos',
    rebased: 'El formulario muestra ahora los valores de la otra persona. Revíselo y vuelva a guardar.',
  },
  fieldConflict: '{name} ha modificado este campo {time}:',
  useTheirs: 'Usar ese valor',
  saveMine: 'Guardar el mío',
} satisfies Translation['collab'];
