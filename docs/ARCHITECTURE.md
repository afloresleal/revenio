# Arquitectura — Revenio Voice Agent

## Diagrama de Flujo

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  LeadsBridge │────▶│  Revenio API │────▶│    VAPI     │
│  (webhook)   │     │  /call/test  │     │  call/phone │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Twilio    │◀────│  Assistant  │
                    │  (número)   │     │  (gpt-4o)   │
                    └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Usuario   │
                    │  (lead MX)  │
                    └──────┬──────┘
                           │ transfer
                           ▼
                    ┌─────────────┐
                    │   Asesor    │
                    │  (humano)   │
                    └─────────────┘
```

## Componentes

### 1. Revenio API (`apps/api/`)

**Responsabilidades:**
- Recibir leads (POST /api/leads)
- Disparar llamadas (POST /call/test)
- Recibir webhooks VAPI/Twilio
- Persistir eventos y resultados

**Tecnología:** Express + TypeScript + Prisma

### 2. VAPI Assistant

**Responsabilidades:**
- Ejecutar conversación de voz
- Detectar cuándo transferir
- Llamar tool `transferCall`

**Configuración:** Ver [VAPI-CONFIG.md](VAPI-CONFIG.md)

### 3. Twilio

**Responsabilidades:**
- Número de salida (+1 350 216 9412)
- Routing de llamadas
- Recording (opcional)

### 4. Lab UI (`apps/lab/`)

**Responsabilidades:**
- Interfaz para disparar llamadas de prueba
- Ver historial de leads/calls
- Configurar parámetros

## Base de Datos

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    Lead     │────▶│ CallAttempt │────▶│    Event    │
│             │     │             │     │             │
│ - id        │     │ - id        │     │ - id        │
│ - phone     │     │ - leadId    │     │ - leadId    │
│ - name      │     │ - providerId│     │ - type      │
│ - status    │     │ - resultJson│     │ - payload   │
│ - campaign  │     │ - createdAt │     │ - createdAt │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Flujo de Llamada

1. **Trigger:** Lead llega vía webhook o manual
2. **Call:** API dispara llamada via VAPI
3. **Connect:** VAPI conecta con Twilio, Twilio marca al lead
4. **Conversation:** Assistant saluda y transfiere
5. **Transfer:** VAPI ejecuta transferCall al asesor
6. **Webhook:** VAPI/Twilio envían resultado
7. **Persist:** API guarda evento y actualiza lead

## Endpoints Principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /health | Status del servicio |
| POST | /api/leads | Crear lead |
| GET | /api/leads | Listar leads |
| POST | /call/test | Disparar llamada |
| POST | /webhooks/vapi/result | Webhook resultado VAPI |
| POST | /webhooks/twilio/status | Webhook status Twilio |
