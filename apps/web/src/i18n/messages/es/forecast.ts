import type { Translation } from '../../index.ts';

export default {
  title: 'Previsión de ventas',
  subtitle: {
    one: '{objects} que se cierran en el plazo de {count} mes (a partir del inicio de este mes).',
    other: '{objects} que se cierran en el plazo de {count} meses (a partir del inicio de este mes).',
  },
  opportunities: 'Oportunidades',

  groupBy: 'Agrupar por',
  byMonth: 'Por mes',
  byOwner: 'Por propietario',
  byCloseMonth: 'Por mes de cierre',
  window: 'Período',
  monthCount: { one: '{count} mes', other: '{count} meses' },

  truncated:
    'Previsión parcial: se muestran {shown} de {total} oportunidades coincidentes. Ninguna de las cifras siguientes incluye las oportunidades restantes.',

  measures: {
    closedWon: 'Cerradas ganadas',
    commit: 'Compromiso',
    bestCase: 'Mejor caso',
    openPipeline: 'Canalización abierta',
    weighted: 'Ponderado',
  },
  hints: {
    commit: 'Abiertas, con probabilidad de cierre',
    bestCase: 'Incluye compromiso',
    weighted: 'Ponderado: {amount}',
    opportunities: 'Abiertas y cerradas',
  },

  chartByMonth: 'Gráfico de previsión por mes de cierre',
  chartByOwner: 'Gráfico de previsión por propietario',
  empty: 'No se cierra ninguna oportunidad en este período.',

  breakdown: 'Desglose',
  columns: {
    closeMonth: 'Mes de cierre',
    count: 'N.º oport.',
  },

  footnote:
    'La canalización abierta incluye todas las oportunidades abiertas. Compromiso = categoría de previsión “Compromiso” o probabilidad ≥ 75 %. Mejor caso = compromiso más categoría de previsión “Mejor caso” o probabilidad ≥ 50 %. Ponderado = importe × probabilidad. Solo se incluyen las oportunidades que usted puede ver.',
} satisfies Translation['forecast'];
