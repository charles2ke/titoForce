import type { Translation } from '../../index.ts';

export default {
  others: { one: '{count} outra pessoa neste registro', other: '{count} outras pessoas neste registro' },
  viewing: '{name} está visualizando',
  editing: '{name} está editando',
  editingField: '{name} está editando {field}',
  more: { one: 'Mais {count} pessoa', other: 'Mais {count} pessoas' },
  someone: 'Alguém',
  changed: '{name} acabou de alterar este registro. As alterações feitas em campos que você não editou são exibidas aqui.',
  changedEdited: 'Essa pessoa também alterou {fields}, que você editou. Ao salvar, você escolhe quais valores manter.',
  conflict: {
    title: 'Outra pessoa alterou os mesmos campos',
    message: 'Estes campos foram alterados depois que você começou a editar. Escolha quais valores manter.',
    theirValue: 'Valor da outra pessoa',
    yourValue: 'Seu valor',
    by: '{name}, {time}',
    useTheirs: 'Usar os valores da outra pessoa',
    saveMine: 'Salvar os meus mesmo assim',
    rebased: 'O formulário agora mostra os valores da outra pessoa. Revise-o e salve novamente.',
  },
  fieldConflict: '{name} alterou este campo {time}:',
  useTheirs: 'Usar esse valor',
  saveMine: 'Salvar o meu',
} satisfies Translation['collab'];
