import type { Translation } from '../../index.ts';

export default {
  spinner: 'Carregando',
  requiredSuffix: '(obrigatório)',
  tryAgain: 'Tentar novamente',
  unsaved: {
    title: 'Descartar alterações não salvas?',
    message: 'Suas alterações nesta página não foram salvas.',
    discard: 'Descartar alterações',
  },

  pagination: {
    range: '{from}–{to} de {total}',
  },

  fieldValue: {
    restricted: 'Registro restrito',
  },

  lookup: {
    selected: 'Registro selecionado',
    clear: 'Limpar seleção',
    searchAny: 'Pesquisar qualquer registro…',
    searchObject: 'Pesquisar {objects}…',
    searchRecords: 'Pesquisar registros…',
    searching: 'Pesquisando…',
    typeToSearch: 'Digite para pesquisar',
    noMatches: 'Nenhum resultado',
  },

  recordForm: {
    newTitle: 'Criar {object}',
    editTitle: 'Editar {name}',
    defaultSection: 'Informações de {object}',
    fixFields: 'Corrija os campos destacados.',
    saveAnyway: 'Salvar mesmo assim',
    saved: 'Registro salvo: {object} “{name}”',
    created: 'Registro criado: {object} “{name}”',
  },

  iconPicker: {
    choose: 'Escolha um ícone',
    label: 'Ícones',
  },

  icons: {
    bookOpen: 'livro aberto',
    bot: 'robô',
    briefcase: 'maleta',
    building: 'prédio',
    building2: 'prédio 2',
    calendarCheck: 'calendário com visto',
    calendarDays: 'calendário com dias',
    chartColumn: 'gráfico de colunas',
    barChart3: 'gráfico de barras 3',
    clipboardList: 'prancheta com lista',
    contact: 'contato',
    fileText: 'arquivo de texto',
    folderKanban: 'pasta kanban',
    globe: 'globo',
    handshake: 'aperto de mãos',
    headphones: 'fones de ouvido',
    heartHandshake: 'aperto de mãos com coração',
    home: 'lar',
    house: 'casa',
    idCard: 'cartão de identificação',
    kanban: 'kanban',
    layoutGrid: 'grade de layout',
    lifeBuoy: 'boia salva-vidas',
    list: 'lista',
    mail: 'correio',
    megaphone: 'megafone',
    network: 'rede',
    package: 'pacote',
    rocket: 'foguete',
    shieldCheck: 'escudo com visto',
    sparkles: 'brilhos',
    squareCheckBig: 'quadrado com visto grande',
    star: 'estrela',
    target: 'alvo',
    trendingUp: 'tendência de alta',
    trophy: 'troféu',
    userCheck: 'usuário com visto',
    userPlus: 'usuário com sinal de mais',
    users: 'usuários',
    wand: 'varinha mágica',
    workflow: 'fluxo de trabalho',
    zap: 'raio',
  },

  colors: {
    gray: 'cinza',
    blue: 'azul',
    green: 'verde',
    yellow: 'amarelo',
    orange: 'laranja',
    red: 'vermelho',
    purple: 'roxo',
    pink: 'rosa',
    teal: 'verde-azulado',
    indigo: 'índigo',
  },

  chart: {
    noData: 'Sem dados',
  },

  dashboard: {
    report: 'Relatório',
    reportDeleted: 'O relatório foi excluído',
    loadFailed: 'Não foi possível carregar este relatório.',
    emptyTitle: 'Este painel ainda não tem widgets',
    emptyBody: 'Adicione relatórios ao painel para ver os gráficos deles aqui.',
  },

  notFound: {
    title: 'Página não encontrada',
    body: 'A página que você procura não existe ou você não tem acesso a ela.',
    home: 'Ir para o início',
  },

  routeError: {
    newVersion: 'Uma nova versão está disponível',
    reloadToContinue: 'Recarregue a página para continuar.',
    unknown: 'Erro desconhecido',
  },

  homeRedirect: {
    noApps: 'Nenhum aplicativo ainda',
    noAppsHelp: 'Peça a um administrador para criar um aplicativo em Configuração.',
  },
} satisfies Translation['components'];
