# ANÁLISIS COMPLETO DE LOGS - CAMPAÑA FALLANDO
Fecha: 2026-08-27
Archivo: logs.1787869113488.json

## 1. DISTRIBUCIÓN DE ENDED REASONS

- **silence-timed-out**: 12/27 (44.4%)
- **customer-did-not-answer**: 6/27 (22.2%)
- **customer-ended-call**: 6/27 (22.2%)
- **voicemail**: 3/27 (11.1%)

## 2. PROBLEMA IDENTIFICADO

**44.4% de llamadas terminan con `silence-timed-out`**

Esto indica que:
- El cliente SÍ contestó el teléfono
- Hubo 30 segundos de silencio (configurado en `silenceTimeoutSeconds: 30`)
- La llamada se terminó automáticamente

### Posibles causas:

1. **Voicemail detection está bloqueando el firstMessage**
   - Vapi espera hasta 20 segundos (`beepMaxAwaitSeconds: 20`) para detectar buzón
   - Durante este tiempo, el assistant NO habla
   - Si la detección falla o tarda mucho:
     - Cliente espera en silencio
     - Llega a 30 segundos de silencio
     - Llamada termina sin que el assistant haya hablado

2. **Assistant no está ejecutando el firstMessage**
   - Problema con variables ({{name}} no está definido)
   - Error en la configuración del assistant
   - El modelo GPT no está generando el mensaje

3. **Transfer nunca se ejecuta**
   - **0 eventos `transfer-destination-request` recibidos**
   - El tool `transferCall` NO está siendo ejecutado
   - Posibles razones:
     - El assistant nunca llega a ejecutar el tool
     - El tool ID `813f90ad-2375-4e4f-a8f4-efac058db4d6` no es el correcto
     - El tool no está configurado correctamente en Vapi
     - GPT-4o-mini no está siguiendo la instrucción del system prompt

## 3. EVIDENCIA EN LOGS

```
Transfer destination requests: 0
transferAttempted: false
hadTransferredAt: false
endedReasonIndicatesTransfer: false
```

## 4. CONFIGURACIÓN DEL ASSISTANT

El assistant tiene el siguiente system prompt:

```
If you detect voicemail, an answering machine, or a recorded greeting from the customer,
stop speaking immediately and end the call. Do not execute transferCall. Do not leave any message.

If a human answers, deliver the first message in Spanish. Immediately after the first message
is fully spoken, execute transferCall. Do not wait for any response from the user.
Do not generate any additional conversation. Do not say anything after executing transferCall.
```

**Problema:** El prompt depende de que Vapi detecte correctamente si es humano o buzón.

## 5. VOICEMAIL DETECTION CONFIG

```json
"voicemailDetection": {
  "provider": "vapi",
  "backoffPlan": {
    "maxRetries": 6,
    "startAtSeconds": 2,
    "frequencySeconds": 2.5
  },
  "beepMaxAwaitSeconds": 20
}
```

**Problema potencial:**
- Si la detección es incorrecta, el assistant puede pensar que es buzón cuando es humano
- Si la detección tarda >20 segundos, ya pasaron 20 segundos de silencio
- Solo quedan 10 segundos antes del timeout de silencio (30 total)

