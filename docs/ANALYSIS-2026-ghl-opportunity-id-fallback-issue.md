# Análisis: Error 404 en GHL Opportunity Update

**Fecha:** 2026-08-27
**Contexto:** Campaña en producción fallando al actualizar oportunidades en GHL

## Problema Identificado

### Error 1: GHL Opportunity Not Found (404)

```
GHL_RESPONSE | status:404 | ok:false |
data:{"statusCode":404,"error":"Not Found","message":"Opportunity not found","code":"OPPORTUNITY_NOT_FOUND"}
```

**CallId afectado:** `01a024ed-2e50-733b-9dab-84b2e25dc2c2`
**OppId generado:** `ghl-workflow-1787325807443`

### Error 2: Recording Download Failed (400)

```
error: 'Error: recording_download_failed:400'
```

**CallId afectado:** `01a024fa-0300-733b-9e48-f6a1624a3d8b`

---

## Causa Raíz del Error 1 (Principal)

### Código Problemático

**Ubicación:** `apps/api/src/routes/webhooks.ts:1604`

```typescript
async function startVapiCallFromGhlWebhook(input: z.infer<typeof ghlOpportunityAssignedSchema>) {
  const locationId = input.locationId;
  const assignedTo = input.assignedTo;
  const eventType = input.type ?? 'OpportunityAssignedTo';
  const opportunityId = input.id ?? `ghl-workflow-${Date.now()}`; // ⚠️ PROBLEMA AQUÍ
  const requestedCampaignId = input.campaignId;
  // ...
}
```

**También en:** `apps/api/src/routes/webhooks.ts:1525`

```typescript
return {
  // ...
  id: pickFirstString(
    root.id,
    root.opportunityId,
    root.opportunity_id,
    customData?.id,
    customData?.opportunityId,
    customData?.opportunity_id,
    opportunity?.id
  ) ?? `ghl-workflow-${Date.now()}`, // ⚠️ FALLBACK PROBLEMÁTICO
  // ...
};
```

### Qué está pasando

1. **Webhook de GHL llega SIN opportunity ID**
   - El webhook puede venir sin `id`, `opportunityId`, o `opportunity_id`
   - Posibles razones:
     - El webhook viene de un workflow de GHL, no de una oportunidad
     - El webhook viene de un trigger diferente al esperado
     - La estructura del webhook de GHL cambió

2. **Sistema genera ID temporal**
   - Fallback: `ghl-workflow-${Date.now()}`
   - Ejemplo: `ghl-workflow-1787325807443`
   - Este ID NO existe en GHL

3. **Llamada se procesa normalmente**
   - Vapi realiza la llamada
   - La llamada termina (en este caso con outcome "voicemail")

4. **Sistema intenta actualizar oportunidad en GHL**
   - Usa el ID falso generado
   - GHL responde con 404 Not Found
   - Error se loguea pero la llamada ya se procesó

### Por qué es problemático

1. **Silently fails:** La llamada se hace, pero GHL nunca se actualiza
2. **Métricas incorrectas:** GHL no refleja el outcome real de la llamada
3. **Operación no se puede revertir:** La llamada ya se hizo y se consumió crédito
4. **Confusión operativa:** El equipo ve llamadas en Vapi/Revenio que no están actualizadas en GHL

---

## Análisis de Logs

### Distribución de EndedReasons

De 990 logs totales:

- `silence-timed-out`: 12 veces (44%)
- `customer-did-not-answer`: 6 veces (22%)
- `customer-ended-call`: 6 veces (22%)
- `voicemail`: 3 veces (11%)

### Outcomes Clasificados

```
voicemail  -> stageId:d5a14ea9-5dca-4716-aff4-e4a62b8ba (con error 404)
abandoned  -> stageId:none (sin error, no se intenta actualizar)
completed  -> stageId:none (sin error, no se intenta actualizar)
```

**Observación:** Solo la llamada con outcome `voicemail` intentó actualizar GHL y falló.

---

## Causa Raíz del Error 2 (Secundario)

### Recording Download Failed (400)

Este error ocurre cuando:

1. Vapi reporta `hasRecording: true`
2. El sistema intenta descargar la grabación para transcripción
3. La URL de grabación o el call ID generan un error 400

**Posibles causas:**

- Llamada muy reciente (grabación aún no disponible)
- URL de grabación inválida o expirada
- Permisos insuficientes en Vapi API
- Problema de retención de Vapi (>14 días, aunque poco probable aquí)

**Estado actual:** Ya existe manejo para errores de retención según changelog 2026-08-25, pero no para errores 400 genéricos.

---

## Soluciones Propuestas

### Opción 1: Validar Opportunity ID ANTES de iniciar llamada (RECOMENDADA)

**Cambio en `startVapiCallFromGhlWebhook()`:**

```typescript
async function startVapiCallFromGhlWebhook(input: z.infer<typeof ghlOpportunityAssignedSchema>) {
  const locationId = input.locationId;
  const assignedTo = input.assignedTo;
  const eventType = input.type ?? 'OpportunityAssignedTo';

  // ✅ Validar que venga un opportunity ID real
  const opportunityId = pickFirstString(
    input.id,
    input.opportunityId,
    input.opportunity_id
  );

  if (!opportunityId) {
    return {
      ok: false,
      error: 'missing_opportunity_id',
      reason: 'GHL webhook did not provide a valid opportunity ID',
      locationId,
      campaignId: input.campaignId,
    };
  }

  // Continuar con la lógica normal...
}
```

**Ventajas:**
- Previene llamadas que no se pueden trackear en GHL
- Falla rápido con mensaje claro
- No consume créditos de Vapi/Twilio innecesariamente

**Desventajas:**
- Si el webhook de GHL legítimamente no trae opportunity ID, las llamadas no se harán

---

### Opción 2: NO intentar actualizar GHL si el ID es fallback

**Cambio en `pushSuccessfulTransferToGhl()` o función equivalente:**

```typescript
async function pushSuccessfulTransferToGhl(params: {
  // ...
  opportunityId: string;
  // ...
}) {
  // ✅ Detectar IDs de fallback y skipear
  if (params.opportunityId.startsWith('ghl-workflow-')) {
    console.log('Skipping GHL update: opportunityId is a fallback value', {
      opportunityId: params.opportunityId,
      callId: params.callId,
    });
    return {
      ok: true,
      skipped: true,
      reason: 'fallback_opportunity_id',
      opportunityId: params.opportunityId,
    };
  }

  // Continuar con update normal...
}
```

**Ventajas:**
- Permite que las llamadas se hagan de todos modos
- Evita errores 404 en GHL
- Útil si algunos webhooks legítimamente no traen opportunity ID

**Desventajas:**
- Las llamadas no se reflejarán en GHL (pérdida de datos operativos)
- No soluciona el problema de raíz

---

### Opción 3: Logging y alertas para IDs de fallback

**Agregar logging mejorado:**

```typescript
const opportunityId = pickFirstString(
  input.id,
  input.opportunityId,
  input.opportunity_id
) ?? `ghl-workflow-${Date.now()}`;

if (opportunityId.startsWith('ghl-workflow-')) {
  console.warn('⚠️ GHL webhook missing opportunity ID, using fallback', {
    eventType: input.type,
    locationId: input.locationId,
    campaignId: input.campaignId,
    assignedTo: input.assignedTo,
    contactId: input.contactId,
    webhookPayload: JSON.stringify(input),
  });
}
```

**Ventajas:**
- Visibilidad del problema en logs
- Permite debugging del webhook de GHL
- No bloquea llamadas

**Desventajas:**
- No previene el error 404
- Requiere monitoreo activo de logs

---

## Fix para Error 2: Recording Download Failed (400)

### Manejo de errores 400 en descarga de grabaciones

**Ubicación probable:** `apps/api/src/lib/transcription.ts` o `apps/api/src/lib/vapi-recording-extraction.ts`

**Cambio sugerido:**

```typescript
async function transcribeRecordingFromUrl(recordingUrl: string, callId: string) {
  try {
    const response = await fetch(recordingUrl);

    if (response.status === 400) {
      console.log('Recording not yet available (400), skipping transcription', {
        callId,
        recordingUrl,
      });
      return null; // Retornar null en vez de throw
    }

    if (response.status === 404) {
      console.log('Recording not found (404), may be expired or invalid', {
        callId,
        recordingUrl,
      });
      return null;
    }

    if (!response.ok) {
      throw new Error(`recording_download_failed:${response.status}`);
    }

    // Continuar con transcripción...
  } catch (error) {
    // Manejar error gracefully
    console.error('Failed to transcribe recording', { callId, error });
    return null; // No romper el flujo
  }
}
```

---

## Recomendaciones

### Prioridad ALTA (Fix inmediato)

1. **Implementar Opción 1:** Validar opportunity ID antes de iniciar llamada
2. **Agregar Opción 3:** Logging mejorado para debugging
3. **Fix Error 2:** Manejo graceful de errores 400 en descarga de grabaciones

### Prioridad MEDIA (Investigación)

4. **Analizar webhooks de GHL:**
   - ¿Por qué algunos webhooks no traen opportunity ID?
   - ¿Viene de un workflow o de un trigger diferente?
   - ¿Cambió la estructura del webhook en GHL?

5. **Revisar configuración en GHL:**
   - Verificar que el workflow/trigger correcto esté configurado
   - Confirmar que el campo opportunity ID se está pasando

### Prioridad BAJA (Mejora a futuro)

6. **Considerar webhooks alternativos:**
   - Si el problema es el tipo de webhook, usar otro evento de GHL
   - Ejemplo: `OpportunityStageChanged` en vez de `OpportunityAssignedTo`

---

## Checklist de Implementación

- [ ] Implementar validación de opportunity ID (Opción 1)
- [ ] Agregar logging mejorado para IDs de fallback (Opción 3)
- [ ] Implementar manejo graceful de errores 400 en grabaciones
- [ ] Agregar tests para casos sin opportunity ID
- [ ] Documentar comportamiento esperado cuando falta opportunity ID
- [ ] Actualizar changelog con el fix
- [ ] Deploy a staging
- [ ] Probar con webhook real de GHL
- [ ] Deploy a producción
- [ ] Monitorear logs post-deploy

---

## Archivos a Modificar

1. `apps/api/src/routes/webhooks.ts` - Validación de opportunity ID
2. `apps/api/src/lib/transcription.ts` - Manejo de errores 400
3. `apps/api/test/webhooks-ghl.test.ts` - Tests para caso sin opportunity ID
4. `changelog.md` - Documentar fix

---

## Notas Adicionales

- **No es un problema de número Vapi o assistant ID** - Estos están configurados correctamente
- **No es un problema de Twilio** - Las llamadas se están realizando
- **El problema es específico de GHL** - La integración con GHL está fallando por falta de datos del webhook
