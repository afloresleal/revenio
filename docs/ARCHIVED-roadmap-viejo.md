# Roadmap — Revenio MVP

> Basado en auditoría técnica 2026-02-17 (<CLAWDBOT_INTERNO> + Codex)

## 🎯 North Star

**El agente de voz debe transferir la llamada SIN PREGUNTAR.**

```
Saludo → Transfer inmediato → <30 segundos total
```

---

## Fase 0: Cumplir North Star (Día 0-1) 🔥

**Objetivo:** Transfer sin preguntar

- [ ] Actualizar prompt del assistant (eliminar confirmaciones)
- [ ] Cambiar `firstMessage` a saludo + transfer inmediato
- [ ] Mover mensaje de transfer al `tool.message`
- [ ] Ajustar `silenceTimeoutSeconds` y `maxDurationSeconds`

**Criterio de éxito:** Llamada de prueba transfiere en <30s sin preguntas

---

## Fase 1: Seguridad Mínima (Día 2-4)

**Objetivo:** Proteger endpoints

- [ ] Verificación de firma en webhooks VAPI
- [ ] Verificación de firma en webhooks Twilio
- [ ] API key para endpoints internos (`/call/*`)
- [ ] Rate limiting en endpoints públicos

**Criterio de éxito:** Webhooks rechazan requests sin firma válida

---

## Fase 2: KPIs y Observabilidad (Semana 1)

**Objetivo:** Medir lo que importa

- [ ] Guardar `call_started_at` en DB
- [ ] Guardar `transfer_initiated_at` en DB
- [ ] Guardar `call_ended_at` en DB
- [ ] Calcular métrica: `saludo → transfer` (segundos)
- [ ] Calcular métrica: `transfer_success` (%)
- [ ] Calcular métrica: `abandonment` (%)
- [ ] Logging estructurado con `lead_id` / `attempt_id`

**Criterio de éxito:** Dashboard muestra métricas en tiempo real

---

## Fase 3: Robustez & Fallbacks (Semana 2)

**Objetivo:** No perder llamadas

- [ ] Retries con backoff para VAPI (5xx, timeout)
- [ ] Retries con backoff para Twilio
- [ ] Fallback si transfer falla: colgar con mensaje breve
- [ ] Monitor de estado de asesor (número disponible)
- [ ] Alertas Slack si falla >3 llamadas seguidas

**Criterio de éxito:** Sistema se recupera de fallos transitorios

---

## Fase 4: Dashboard Minimal (Semana 2-3)

**Objetivo:** Visibilidad operativa

- [ ] Vista "Últimas 50 llamadas"
- [ ] Columnas: lead, status, tiempo a transfer, resultado
- [ ] Botón "reintentar" por llamada
- [ ] Export CSV
- [ ] Filtros por fecha/status

**Criterio de éxito:** Operador puede monitorear sin acceso a DB

---

## Backlog (Post-MVP)

- [ ] Health check automático Twilio↔VAPI
- [ ] Auto-heal de desync
- [ ] Análisis de grabaciones con AI (sentiment, summary)
- [ ] A/B testing de prompts
- [ ] Integración con CRM (GoHighLevel)
- [ ] Múltiples campañas con configs diferentes

---

## Métricas de Éxito

| Métrica | Target | Actual |
|---------|--------|--------|
| Transfer success | >90% | TBD |
| Tiempo greeting→transfer | <30s | TBD |
| Abandonment | <10% | TBD |
| Uptime | >99% | TBD |
