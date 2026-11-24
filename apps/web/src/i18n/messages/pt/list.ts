import type { Translation } from '../../index.ts';

export default {
  viewType: {
    table: 'Tabela',
    kanban: 'Kanban',
    calendar: 'Calendário',
    timeline: 'Linha do tempo',
  },

  views: {
    all: '{plural}: todos os registros',
    pickerLabel: 'Selecionar exibição de lista',
    menuLabel: 'Exibições de lista',
    shared: 'Exibições compartilhadas',
    mine: 'Minhas exibições',
    others: 'Exibições de outros usuários',
    actions: 'Ações da exibição',
    rename: 'Renomear',
    delete: 'Excluir exibição',
    saveAs: 'Salvar como exibição',
    saveAsTitle: 'Salvar como nova exibição',
    renameTitle: 'Renomear exibição',
    copyName: '{name} (cópia)',
    nameLabel: 'Nome da exibição',
    nameRequired: 'Dê um nome à exibição.',
    shareWithEveryone: 'Compartilhar com todos',
    savedNew: 'Exibição “{name}” salva',
    saved: 'Exibição salva',
    deleteTitle: 'Excluir exibição de lista?',
    deleteMessage: '“{name}” será removida.',
    deleteMessageShared: '“{name}” será removida para todos.',
    deleted: 'Exibição excluída',
  },

  columns: {
    button: 'Colunas',
    shown: '{shown} de {max} colunas exibidas',
    reset: 'Restaurar padrão',
  },

  toolbar: {
    displayAs: 'Exibir como',
    groupBy: 'Agrupar por',
    dateField: 'Data',
    searchPlaceholder: 'Pesquisar {plural}…',
    searchLabel: 'Pesquisar {plural}',
    filters: 'Filtros',
    filtersCount: 'Filtros ({count})',
    clearFilters: 'Limpar filtros',
    resetToView: 'Restaurar exibição',
    filteredBy: 'Filtrado por:',
  },

  import: {
    title: 'Importar {plural}',
    instructions:
      'A primeira linha deve conter cabeçalhos de coluna que correspondam aos rótulos ou nomes de API dos campos de {label}. Campos de pesquisa e usuários podem ser informados por nome, ID ou (no caso de usuários) email. Até {max} linhas.',
    file: 'Arquivo CSV',
    contentsOf: 'Conteúdo de {file}',
    paste: 'Ou cole o CSV',
    created: { one: '{count} registro de {singular} criado.', other: '{count} registros de {plural} criados.' },
    createdWithFailures: {
      one: '{count} registro de {singular} criado; falha em {rows}.',
      other: '{count} registros de {plural} criados; falha em {rows}.',
    },
    rows: { one: '{count} linha', other: '{count} linhas' },
    rowError: 'Linha {row}: {message}',
    columnMapping: 'Mapeamento de colunas',
    ignored: 'ignorada',
  },

  objectNotFound: {
    title: 'Objeto não encontrado',
    body: 'Ele pode ter sido excluído ou você pode não ter acesso a ele.',
  },
} satisfies Translation['list'];
