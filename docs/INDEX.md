# 📚 Índice de Documentación — Revenio

> **Última actualización:** 2026-05-16 (agregado testing & code review guidelines)

Este índice organiza toda la documentación de Revenio por estado y propósito.

---

## 📘 Documentación Activa (Referencia Permanente)

Documentos de referencia que se mantienen actualizados.

| Documento | Descripción | Última actualización |
|-----------|-------------|---------------------|
| [ACTIVE-admin-ghl-campaigns.md](ACTIVE-admin-ghl-campaigns.md) | Guía completa del panel Admin para gestión de campañas GHL | 2026-05-12 |
| [ACTIVE-api-reference.md](ACTIVE-api-reference.md) | Referencia de endpoints API de Revenio | 2026-05-12 |
| [ACTIVE-architecture.md](ACTIVE-architecture.md) | Arquitectura del sistema: flujos, componentes, integración Vapi/Twilio | 2026-05-07 |
| [ACTIVE-vapi-config.md](ACTIVE-vapi-config.md) | Configuración de asistentes Vapi, voice settings, webhooks | 2026-05-12 |
| [TESTING-AND-REVIEW-GUIDELINES.md](TESTING-AND-REVIEW-GUIDELINES.md) | Procesos de testing y code review: checklists, estrategias, lecciones aprendidas | 2026-05-16 |

---

## ✅ Implementado (Referencia Histórica)

Features implementadas con documentación técnica completa. Mantener como referencia.

| Documento | Descripción | Fecha implementación |
|-----------|-------------|---------------------|
| [IMPLEMENTED-2026-05-14-blind-transfer-fix.md](IMPLEMENTED-2026-05-14-blind-transfer-fix.md) | Fix: Habilitado failover automático eliminando blind-transfer hooks | 2026-05-14 |
| [IMPLEMENTED-2026-05-14-call-window-per-campaign.md](IMPLEMENTED-2026-05-14-call-window-per-campaign.md) | Feature: Horario de llamadas por campaña (Fase 1 + Fase 2) | 2026-05-14 |
| [IMPLEMENTED-2026-05-14-call-window-validation.md](IMPLEMENTED-2026-05-14-call-window-validation.md) | Guía de validación para call window Phase 1 | 2026-05-14 |
| [IMPLEMENTED-2026-05-03-ghl-demo-handoff.md](IMPLEMENTED-2026-05-03-ghl-demo-handoff.md) | Handoff: Configuración GHL para demo con cliente | 2026-05-03 |
| [IMPLEMENTED-twilio-transfer-failover.md](IMPLEMENTED-twilio-transfer-failover.md) | Setup: Twilio AMD + round robin failover | Implementado |

---

## 📋 Análisis y Planes (No Implementado / Parcial)

Documentos de análisis, planes futuros o features parcialmente implementadas.

| Documento | Descripción | Estado |
|-----------|-------------|--------|
| [ANALYSIS-2026-plan-multi-cliente.md](ANALYSIS-2026-plan-multi-cliente.md) | Plan de arquitectura multi-cliente | Pendiente |
| [ANALYSIS-2026-plan-remarketing-campaigns.md](ANALYSIS-2026-plan-remarketing-campaigns.md) | Propuesta compartible para módulo de remarketing por campaña | Planeación |
| [ANALYSIS-2026-plan-call-balancing-agents.md](ANALYSIS-2026-plan-call-balancing-agents.md) | Propuesta compartible para balanceo de llamadas entre vendedores | Planeación |
| [ANALYSIS-dashboard-mvp-final.md](ANALYSIS-dashboard-mvp-final.md) | Plan final para Dashboard MVP | En progreso |
| [ANALYSIS-dashboard-mvp-draft.md](ANALYSIS-dashboard-mvp-draft.md) | Draft del plan de Dashboard MVP | Draft |
| [ANALYSIS-codex-review-dashboard.md](ANALYSIS-codex-review-dashboard.md) | Review técnico del dashboard | Review |
| [ANALYSIS-microbloques-sentiment.md](ANALYSIS-microbloques-sentiment.md) | Análisis de sentiment en microbloques | Análisis |
| [ANALYSIS-campaign-transfer-flow.md](ANALYSIS-campaign-transfer-flow.md) | Flujo de transfer por campaña con partners | Análisis |
| [ANALYSIS-mb-dynamic-name-v3.md](ANALYSIS-mb-dynamic-name-v3.md) | Microbloque de nombre dinámico (versión 3 - final) | Análisis |

---

## 🗄️ Archivado (Obsoleto / Reemplazado)

Documentos obsoletos, reemplazados por versiones nuevas, o que no se implementaron.

| Documento | Razón | Fecha archivado |
|-----------|-------|-----------------|
| [ARCHIVED-2026-04-08-call-transfer-handoff.md](ARCHIVED-2026-04-08-call-transfer-handoff.md) | Reemplazado por versión de mayo 2026 | 2026-05-03 |
| [ARCHIVED-2026-04-27-ghl-guia-integracion-pruebas.md](ARCHIVED-2026-04-27-ghl-guia-integracion-pruebas.md) | Credenciales de prueba GHL obsoletas (cubierto por ACTIVE-admin-ghl-campaigns.md) | 2026-04-27 |
| [ARCHIVED-clawdbot-handoff-inicial.md](ARCHIVED-clawdbot-handoff-inicial.md) | Handoff técnico inicial de desarrollo (arquitectura evolucionó) | 2026-05-14 |
| [ARCHIVED-mb-dynamic-name-v1.md](ARCHIVED-mb-dynamic-name-v1.md) | Reemplazado por v3 | 2026-05-12 |
| [ARCHIVED-mb-dynamic-name-v2.md](ARCHIVED-mb-dynamic-name-v2.md) | Reemplazado por v3 | 2026-05-12 |
| [ARCHIVED-ghl-client-integration.md](ARCHIVED-ghl-client-integration.md) | Integración específica no continuada | 2026-05-12 |
| [ARCHIVED-ghl-request-clawdbot.md](ARCHIVED-ghl-request-clawdbot.md) | Request específico completado | 2026-05-12 |
| [ARCHIVED-prompt-ui-sentiment.md](ARCHIVED-prompt-ui-sentiment.md) | Prompts experimentales no usados | 2026-05-07 |
| [ARCHIVED-resumen-inicial.md](ARCHIVED-resumen-inicial.md) | Resumen inicial de onboarding (ya no necesario) | 2026-05-07 |
| [ARCHIVED-roadmap-viejo.md](ARCHIVED-roadmap-viejo.md) | Roadmap obsoleto (ver CHANGELOG para features actuales) | 2026-05-07 |

---

## 📁 Carpetas Especiales

### `superpowers/`
Documentos generados por superpowers CLI (planes y specs autogenerados).

- `plans/2026-05-03-multi-campaign-mvp.md` - Plan multi-campaign generado
- `specs/2026-05-03-multi-campaign-mvp-design.md` - Spec de diseño

### `screenshots/`
Capturas de pantalla para documentación y guías.

### `GUIA_ADMIN_REVENIO.pdf`
Guía visual en PDF para el equipo de marketing (Admin panel).

---

## 🔍 Cómo usar este índice

**Para encontrar documentación:**
1. **Referencia actual** → Busca en "Documentación Activa"
2. **Feature implementada** → Busca en "Implementado"
3. **Planificación futura** → Busca en "Análisis y Planes"
4. **Contexto histórico** → Busca en "Archivado"

**Convenciones de nombres:**
- `ACTIVE-*` → Documentación de referencia permanente
- `IMPLEMENTED-YYYY-MM-DD-*` → Features implementadas con fecha
- `ANALYSIS-*` → Análisis, planes, specs no implementados
- `ARCHIVED-*` → Documentos obsoletos o reemplazados

---

## 📝 CHANGELOG vs Docs

**CHANGELOG.md:** Lista cronológica de cambios en el código (qué se implementó, cuándo, commits)

**docs/:** Documentación técnica detallada (cómo funciona, por qué se hizo, arquitectura)

Para historial de features implementadas, ver: `CHANGELOG.md`
Para detalles técnicos de una feature, buscar en: `docs/IMPLEMENTED-*`

---

**Última revisión del índice:** 2026-05-14 por <AI_ASSISTANT> Sonnet 4.5
