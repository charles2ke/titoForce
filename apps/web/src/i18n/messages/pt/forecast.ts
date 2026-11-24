import type { Translation } from '../../index.ts';

export default {
  title: 'Previsão de vendas',
  subtitle: {
    one: '{objects} com fechamento em {count} mês (a partir do início deste mês).',
    other: '{objects} com fechamento nos próximos {count} meses (a partir do início deste mês).',
  },
  opportunities: 'Oportunidades',

  groupBy: 'Agrupar por',
  byMonth: 'Por mês',
  byOwner: 'Por proprietário',
  byCloseMonth: 'Por mês de fechamento',
  window: 'Período',
  monthCount: { one: '{count} mês', other: '{count} meses' },

  truncated:
    'Previsão parcial: mostrando {shown} de {total} oportunidades correspondentes. Todos os números abaixo excluem as oportunidades restantes.',

  measures: {
    closedWon: 'Fechado/ganho',
    commit: 'Compromisso',
    bestCase: 'Melhor caso',
    openPipeline: 'Pipeline em aberto',
    weighted: 'Ponderado',
  },
  hints: {
    commit: 'Em aberto, com fechamento provável',
    bestCase: 'Inclui compromisso',
    weighted: 'Ponderado: {amount}',
    opportunities: 'Abertas e fechadas',
  },

  chartByMonth: 'Gráfico de previsão por mês de fechamento',
  chartByOwner: 'Gráfico de previsão por proprietário',
  empty: 'Nenhuma oportunidade fecha neste período.',

  breakdown: 'Detalhamento',
  columns: {
    closeMonth: 'Mês de fechamento',
    count: 'Nº de opps',
  },

  footnote:
    'O pipeline em aberto conta todas as oportunidades em aberto. Compromisso = categoria de previsão “Compromisso” ou probabilidade ≥ 75%. Melhor caso = compromisso mais categoria de previsão “Melhor caso” ou probabilidade ≥ 50%. Ponderado = valor × probabilidade. Somente as oportunidades que você pode ver são incluídas.',
} satisfies Translation['forecast'];
