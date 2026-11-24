import type { Translation } from '../../index.ts';

export default {
  tagline: 'El CRM agéntico para toda su empresa.',
  intro: 'Una única plataforma basada en metadatos para clientes, trabajo y personas, con agentes de IA integrados.',
  highlights: {
    sales: 'Ventas: prospectos, cuentas, canalización, presupuestos y previsiones',
    service: 'Servicio: casos, conocimiento y SLA',
    work: 'Trabajo: proyectos, tableros, calendarios y cronogramas',
    people: 'Personas: empleados, ausencias, evaluaciones y contratación',
    ai: 'Agentes de IA que actúan con los mismos permisos que usted',
  },
  license: 'Código abierto · AGPL-3.0',

  title: 'Iniciar sesión',
  subtitle: 'Le damos la bienvenida de nuevo. Introduzca su correo electrónico de trabajo y su contraseña.',
  submit: 'Iniciar sesión',

  demo: {
    signInAs: 'Empresa de demostración: iniciar sesión como',
    password: 'Contraseña de demostración: {password}',
  },
} satisfies Translation['login'];
