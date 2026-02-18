# Changelog

Todos los cambios notables en este proyecto serán documentados aquí.

## [0.2.0] - 2026-02-17

### Reorganizado
- Proyecto adoptado como base principal para Voice Agent MVP
- Auditoría técnica completada (Julia + Codex)
- Documentación consolidada

### Identificado (Gaps)
- Prompt actual pide confirmación antes de transfer (debe ser inmediato)
- Webhooks sin verificación de firma
- Sin rate limiting ni auth en endpoints
- KPIs no calculan tiempo saludo→transfer

### Próximo
- Fase 0: Ajustar prompt para transfer sin preguntar

---

## [0.1.0] - 2026-02-06

### Inicial (Ale)
- Backend Express + TypeScript
- Prisma schema (Lead, CallAttempt, Event)
- Integración VAPI para llamadas outbound
- Webhooks Twilio/VAPI
- Lab UI para pruebas
- Dashboard básico

### Configuración
- Assistant VAPI configurado (gpt-4o-mini + ElevenLabs)
- Número Twilio importado a VAPI
- Deploy en Railway
