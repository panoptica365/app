#!/usr/bin/env python3
"""
Panoptica365 — Security Posture PDF Report Generator
Uses ReportLab for PDF assembly and Matplotlib for chart generation.
Called by the Node.js API with a JSON input file and output path.

Usage: python3 generate-pdf-report.py <input.json> <output.pdf>

Rewritten May 7, 2026 to surface the full data picture: alerts, secure score
+ delta, Conditional Access policies, Security Settings posture, Defender XDR
incidents, operator change log, MSP audit log, exemptions, activity volume.
"""

import sys
import json
import os
from datetime import datetime
from io import BytesIO

# ReportLab imports
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    PageBreak, Table, TableStyle, KeepTogether
)
from reportlab.pdfgen import canvas

# Matplotlib for charts
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# ─── Color palette (Panoptica365) ───
COLORS = {
    'primary': '#2C3E50',      # Dark blue-gray (headings)
    'accent': '#C9A961',       # Gold accent
    'text': '#333333',         # Body text
    'text_light': '#666666',   # Secondary text
    'severe': '#cc4444',
    'high': '#ff9900',
    'medium': '#ffcc66',
    'low': '#6688cc',
    'info': '#9999cc',
    'matched': '#33CC66',
    'drift': '#cc4444',
    'pending': '#FFAA00',
    'unavailable': '#999999',
    'bg_light': '#F8F9FA',
    'border': '#DEE2E6',
}

SEVERITY_ORDER = ['severe', 'high', 'medium', 'low', 'info']
SEVERITY_LABELS = {'severe': 'Critical', 'high': 'High', 'medium': 'Medium', 'low': 'Low', 'info': 'Info'}
SEVERITY_LABELS_FR = {'severe': 'Critique', 'high': 'Élevé', 'medium': 'Moyen', 'low': 'Faible', 'info': 'Info'}
SEVERITY_LABELS_ES = {'severe': 'Crítico', 'high': 'Alto', 'medium': 'Medio', 'low': 'Bajo', 'info': 'Info'}

# ─── Enum-value localization (DB stores English, render in tenant language) ───
# Alert status values (alerts.status). Source: alert lifecycle code.
STATUS_LABELS = {
    'en': {'open': 'open', 'acknowledged': 'acknowledged', 'snoozed': 'snoozed',
           'resolved': 'resolved', 'closed': 'closed', 'in_progress': 'in progress'},
    'fr': {'open': 'ouvert', 'acknowledged': 'pris en charge', 'snoozed': 'reporté',
           'resolved': 'résolu', 'closed': 'fermé', 'in_progress': 'en cours'},
    'es': {'open': 'abierto', 'acknowledged': 'reconocido', 'snoozed': 'aplazado',
           'resolved': 'resuelto', 'closed': 'cerrado', 'in_progress': 'en curso'},
}
# Alert policy categories (alert_policies.category ENUM — strict, 6 values).
ALERT_CATEGORY_LABELS = {
    'en': {'risky_signins': 'Risky Sign-ins', 'threat_mgmt': 'Threat Management',
           'external_sharing': 'External Sharing', 'config_changes': 'Config Changes',
           'permissions': 'Permissions', 'info_governance': 'Info Governance'},
    'fr': {'risky_signins': 'Connexions à risque', 'threat_mgmt': 'Gestion des menaces',
           'external_sharing': 'Partage externe', 'config_changes': 'Changements de config',
           'permissions': 'Permissions', 'info_governance': 'Gouvernance de l\'information'},
    'es': {'risky_signins': 'Inicios de Sesión de Riesgo', 'threat_mgmt': 'Gestión de Amenazas',
           'external_sharing': 'Compartición Externa', 'config_changes': 'Cambios de Configuración',
           'permissions': 'Permisos', 'info_governance': 'Gobernanza de Información'},
}
# Tenant change-log categories (tenant_change_events.category ENUM, ~22 values).
CHANGE_CATEGORY_LABELS = {
    'en': {  # English == identity
        'ca_deploy': 'CA deploy', 'ca_retire': 'CA retire', 'ca_edit': 'CA edit',
        'intune_push': 'Intune push', 'intune_retire': 'Intune retire', 'intune_edit': 'Intune edit',
        'named_location': 'Named location', 'named_location_create': 'Named location create',
        'exemption': 'Exemption', 'exemption_apply': 'Exemption apply', 'exemption_revoke': 'Exemption revoke',
        'alert_exemption_apply': 'Alert exemption apply', 'alert_exemption_revoke': 'Alert exemption revoke',
        'remediation': 'Remediation', 'manual_cleanup': 'Manual cleanup',
        'incident_response': 'Incident response', 'migration': 'Migration',
        'alert_status_change': 'Alert status change', 'alert_note': 'Alert note',
        'ai_severity_revert': 'AI severity revert', 'enforcement_toggle': 'Enforcement toggle',
        'tenant_lifecycle': 'Tenant lifecycle', 'security_setting_change': 'Security setting change',
        'other': 'Other',
    },
    'fr': {
        'ca_deploy': 'Déploiement CA', 'ca_retire': 'Retrait CA', 'ca_edit': 'Modification CA',
        'intune_push': 'Déploiement Intune', 'intune_retire': 'Retrait Intune', 'intune_edit': 'Modification Intune',
        'named_location': 'Emplacement nommé', 'named_location_create': 'Création emplacement nommé',
        'exemption': 'Exemption', 'exemption_apply': 'Application d\'exemption', 'exemption_revoke': 'Révocation d\'exemption',
        'alert_exemption_apply': 'Application d\'exemption d\'alerte', 'alert_exemption_revoke': 'Révocation d\'exemption d\'alerte',
        'remediation': 'Remédiation', 'manual_cleanup': 'Nettoyage manuel',
        'incident_response': 'Réponse à incident', 'migration': 'Migration',
        'alert_status_change': 'Changement de statut d\'alerte', 'alert_note': 'Note d\'alerte',
        'ai_severity_revert': 'Annulation sévérité IA', 'enforcement_toggle': 'Bascule d\'application',
        'tenant_lifecycle': 'Cycle de vie locataire', 'security_setting_change': 'Changement paramètre de sécurité',
        'other': 'Autre',
    },
    'es': {
        'ca_deploy': 'Despliegue CA', 'ca_retire': 'Retiro CA', 'ca_edit': 'Edición CA',
        'intune_push': 'Despliegue Intune', 'intune_retire': 'Retiro Intune', 'intune_edit': 'Edición Intune',
        'named_location': 'Ubicación con nombre', 'named_location_create': 'Crear ubicación con nombre',
        'exemption': 'Exención', 'exemption_apply': 'Aplicar exención', 'exemption_revoke': 'Revocar exención',
        'alert_exemption_apply': 'Aplicar exención de alerta', 'alert_exemption_revoke': 'Revocar exención de alerta',
        'remediation': 'Remediación', 'manual_cleanup': 'Limpieza manual',
        'incident_response': 'Respuesta a incidente', 'migration': 'Migración',
        'alert_status_change': 'Cambio de estado de alerta', 'alert_note': 'Nota de alerta',
        'ai_severity_revert': 'Revertir severidad IA', 'enforcement_toggle': 'Alternar aplicación',
        'tenant_lifecycle': 'Ciclo de vida del inquilino', 'security_setting_change': 'Cambio de configuración de seguridad',
        'other': 'Otro',
    },
}
# Setting categories (security_settings.category ENUM).
SETTING_CATEGORY_LABELS = {
    'en': {'exchange': 'Exchange', 'identity': 'Identity', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Compliance'},
    'fr': {'exchange': 'Exchange', 'identity': 'Identité', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Conformité'},
    'es': {'exchange': 'Exchange', 'identity': 'Identidad', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Cumplimiento'},
}
# Setting event types (security_setting_events.event_type ENUM).
SETTING_EVENT_LABELS = {
    'en': {'applied': 'applied', 'matched': 'matched', 'drift_detected': 'drift detected',
           'remediated': 'remediated', 'accepted': 'accepted',
           'poll_ok': 'poll OK', 'poll_error': 'poll error'},
    'fr': {'applied': 'appliqué', 'matched': 'aligné', 'drift_detected': 'dérive détectée',
           'remediated': 'remédié', 'accepted': 'accepté',
           'poll_ok': 'scrutation OK', 'poll_error': 'erreur de scrutation'},
    'es': {'applied': 'aplicado', 'matched': 'alineado', 'drift_detected': 'desviación detectada',
           'remediated': 'remediado', 'accepted': 'aceptado',
           'poll_ok': 'sondeo OK', 'poll_error': 'error de sondeo'},
}


def localize(value, lookup_map, lang):
    """Look up a localized string for a DB enum value. Falls back to original on miss."""
    if value is None:
        return ''
    return lookup_map.get(lang, lookup_map['en']).get(value, value)


# ─── Locale file loader (alert_policy_names.<slug> dictionary) ────────────
# alert_policies.name is stored in English in the DB. Localized names live in
# locales/{lang}.json under "alert_policy_names.<slug>". Same convention as
# the operator UI (public/js/shared/i18n.js).
import unicodedata as _ud
_LOCALE_CACHE = {}


def _load_locale(project_root, lang):
    """Load locales/{lang}.json once; cached. Returns {} on miss."""
    if lang in _LOCALE_CACHE:
        return _LOCALE_CACHE[lang]
    path = os.path.join(project_root, 'locales', f'{lang}.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            _LOCALE_CACHE[lang] = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        _LOCALE_CACHE[lang] = {}
    return _LOCALE_CACHE[lang]


def _slugify(s):
    """Mirrors public/js/shared/i18n.js slugify(): lowercase + strip diacritics + non-alphanum → _."""
    if not s:
        return ''
    s = str(s).lower()
    # NFKD + drop combining marks (matches JS .normalize('NFKD').replace(/[̀-ͯ]/g, ''))
    s = ''.join(c for c in _ud.normalize('NFKD', s) if not _ud.combining(c))
    out = []
    in_run = False
    for ch in s:
        if ch.isalnum() and ord(ch) < 128:
            out.append(ch)
            in_run = False
        elif not in_run:
            out.append('_')
            in_run = True
    return ''.join(out).strip('_')


def localize_policy_name(name, project_root, lang):
    """Translate an alert_policies.name via locales/{lang}.json alert_policy_names.<slug>.
    Falls back to the original English name if the slug isn't keyed."""
    if not name:
        return name or ''
    if lang == 'en':
        return name  # DB already English
    locale = _load_locale(project_root, lang)
    table = (locale.get('alert_policy_names') or {})
    return table.get(_slugify(name), name)
SEVERITY_COLORS = {
    'severe': COLORS['severe'],
    'high': COLORS['high'],
    'medium': COLORS['medium'],
    'low': COLORS['low'],
    'info': COLORS['info'],
}

# ─── Localized strings (en + fr + es) ───
STRINGS = {
    'en': {
        'report_title': 'Security Posture Report',
        'generated': 'Generated',
        'exec_summary': 'Executive Summary',
        'secure_score': 'Microsoft Secure Score',
        'secure_score_label': 'Secure Score',
        'alert_overview': 'Alert Overview',
        'alert_trend': 'Alert Trend',
        'security_highlights': 'Security Highlights',
        'alert_analysis': 'Alert Analysis',
        'notable_incidents': 'Notable Incidents',
        'recommendations': 'Recommendations',
        'alerts_recorded': '<b>{total}</b> alerts were recorded during the {range} period.',
        'breakdown': 'Breakdown',
        'severity': 'Severity',
        'description': 'Description',
        'status': 'Status',
        'date': 'Date',
        'footer_report': 'Security Posture Report',
        'footer_page': 'Page',
        'footer_generated': 'Generated',
        'footer_confidential_with_platform': 'Confidential — Prepared by {msp} via Panoptica365 for authorized recipients only',
        'footer_confidential_no_platform': 'Confidential — Prepared by {msp} for authorized recipients only',
        'cover_prepared_by': 'Prepared by {msp}',
        'ca_policies_title': 'Conditional Access Policies',
        'ca_policies_intro': 'The following Conditional Access policies are currently configured in this tenant:',
        'ca_cross_analysis': 'Cross-Policy Analysis',
        'settings_title': 'Security Settings Posture',
        'settings_intro': 'Panoptica365 tracks {total} standard security settings against the customer baseline. The following chart shows the current matched/drifting state.',
        'settings_drifting_label': 'Currently Drifting Settings',
        'settings_no_drift': 'All tracked settings are currently matched against the baseline.',
        'settings_recent_label': 'Recent Setting Activity',
        'settings_analysis': 'Settings Posture Analysis',
        'defender_title': 'Microsoft Defender XDR Incidents',
        'defender_intro': '{total} incident(s) opened or updated in Microsoft Defender XDR during this period.',
        'defender_no_incidents': 'No Microsoft Defender XDR incidents were observed during this period.',
        'defender_analysis': 'Defender Incident Analysis',
        'change_log_title': 'Operator Activity (Change Log)',
        'change_log_intro': 'Your MSP performed {total} tracked change(s) in this tenant during the period.',
        'change_log_none': 'No operator changes were recorded for this tenant during the period.',
        'change_log_analysis': 'Operator Activity Analysis',
        'msp_audit_title': 'MSP Audit Trail',
        'msp_audit_intro': '{total} MSP operator action(s) targeting this tenant were logged in Panoptica365.',
        'exemptions_title': 'Active Alert Exemptions',
        'exemptions_intro': '{total} active exemption rule(s) currently auto-resolve specific alert patterns for this tenant.',
        'exemptions_none': 'No active alert exemption rules are configured for this tenant.',
        'activity_title': 'Activity Volume',
        'activity_intro': '{total} total events were recorded across all alert policies during the period.',
        'col_when': 'When', 'col_what': 'What', 'col_who': 'Who', 'col_setting': 'Setting',
        'col_event': 'Event', 'col_priority': 'Priority', 'col_category': 'Category',
        'col_user': 'User', 'col_count': 'Count', 'col_expires': 'Expires',
        'col_policy': 'Policy', 'col_total': 'Total Events',
        'pri_critical': 'Critical', 'pri_high': 'High', 'pri_medium': 'Medium', 'pri_low': 'Low',
        'status_monitored': 'Matched', 'status_drift': 'Drift', 'status_not_applied': 'Not Applied',
        'status_pending': 'Pending', 'status_poll_error': 'Poll Error', 'status_unavailable': 'Unavailable',
        'score_delta_up': 'improved by {delta} points',
        'score_delta_down': 'declined by {delta} points',
        'score_delta_flat': 'unchanged',
        # ─── Report enrichment (Identity Hygiene + Application Risk) ───
        'er_sec_identity': 'Identity Hygiene',
        'er_sec_admins': 'Accounts with Admin Roles',
        'er_sec_inactive': 'Inactive Accounts',
        'er_sec_breakglass': 'Break-Glass (Emergency Access)',
        'er_sec_app_risk': 'Application Risk',
        'er_sec_app_gov': 'Application Governance',
        'er_sec_known_good': 'Known-Good Applications',
        'er_sec_other_apps': 'Other Applications',
        'er_col_account': 'Account',
        'er_col_roles': 'Roles',
        'er_col_enabled': 'Enabled',
        'er_col_mfa': 'MFA',
        'er_col_activity': 'Last Activity',
        'er_col_type': 'Type',
        'er_col_app': 'Application',
        'er_col_publisher': 'Publisher',
        'er_col_verdict': 'Risk Verdict',
        'er_col_permissions': 'Permissions',
        'er_col_drift': 'Drift',
        'er_yes': 'Yes',
        'er_no': 'No',
        'er_unknown': 'Unknown',
        'er_member': 'Member',
        'er_guest': 'Guest',
        'er_verdict_green': 'Green',
        'er_verdict_yellow': 'Yellow',
        'er_verdict_red': 'Red',
        'er_verdict_none': 'Not evaluated',
        'er_drift_yes': 'Drifted',
        'er_never_redeemed': 'Never redeemed',
        'er_breakglass_tag': 'break-glass',
        'er_bg_group_label': 'Group',
        'er_bg_members_label': 'Members',
        'er_none': 'None',
        'er_more': '(+{n} more)',
        'er_no_admins': 'No accounts hold admin roles.',
        'er_no_inactive': 'No inactive accounts.',
        'er_all_known_good': 'All applications are tagged Known-Good.',
        'er_identity_unavailable': 'Access Review data has not been captured for this tenant. Run an Access Review to populate identity hygiene.',
        'er_apps_unavailable': 'Application inventory is not available. Run the Applications scan.',
        'er_bg_not_configured': 'No break-glass (emergency-access) group is configured for this tenant.',
        'er_bg_members_unavailable': 'Group membership could not be read at report time.',
        'er_threshold_note': 'Inactivity threshold: {n} days.',
    },
    'fr': {
        'report_title': 'Rapport de posture de sécurité',
        'generated': 'Généré le',
        'exec_summary': 'Sommaire exécutif',
        'secure_score': 'Score de sécurité Microsoft',
        'secure_score_label': 'Score de sécurité',
        'alert_overview': 'Aperçu des alertes',
        'alert_trend': 'Tendance des alertes',
        'security_highlights': 'Faits saillants de sécurité',
        'alert_analysis': 'Analyse des alertes',
        'notable_incidents': 'Incidents notables',
        'recommendations': 'Recommandations',
        'alerts_recorded': '<b>{total}</b> alertes ont été enregistrées au cours de la période {range}.',
        'breakdown': 'Répartition',
        'severity': 'Sévérité',
        'description': 'Description',
        'status': 'Statut',
        'date': 'Date',
        'footer_report': 'Rapport de posture de sécurité',
        'footer_page': 'Page',
        'footer_generated': 'Généré le',
        'footer_confidential_with_platform': 'Confidentiel — Préparé par {msp} via Panoptica365 pour les destinataires autorisés uniquement',
        'footer_confidential_no_platform': 'Confidentiel — Préparé par {msp} pour les destinataires autorisés uniquement',
        'cover_prepared_by': 'Préparé par {msp}',
        'ca_policies_title': 'Politiques d\'accès conditionnel',
        'ca_policies_intro': 'Les politiques d\'accès conditionnel suivantes sont actuellement configurées dans ce locataire :',
        'ca_cross_analysis': 'Analyse croisée des politiques',
        'settings_title': 'Posture des paramètres de sécurité',
        'settings_intro': 'Panoptica365 surveille {total} paramètres de sécurité standards par rapport à la référence du client. Le graphique ci-dessous montre l\'état actuel correspondant/dérive.',
        'settings_drifting_label': 'Paramètres en dérive',
        'settings_no_drift': 'Tous les paramètres surveillés correspondent actuellement à la référence.',
        'settings_recent_label': 'Activité récente sur les paramètres',
        'settings_analysis': 'Analyse de la posture des paramètres',
        'defender_title': 'Incidents Microsoft Defender XDR',
        'defender_intro': '{total} incident(s) ouvert(s) ou mis à jour dans Microsoft Defender XDR pendant cette période.',
        'defender_no_incidents': 'Aucun incident Microsoft Defender XDR observé pendant cette période.',
        'defender_analysis': 'Analyse des incidents Defender',
        'change_log_title': 'Activité de l\'opérateur (Journal des changements)',
        'change_log_intro': 'Votre prestataire a effectué {total} changement(s) suivi(s) dans ce locataire pendant la période.',
        'change_log_none': 'Aucun changement opérateur enregistré pour ce locataire pendant la période.',
        'change_log_analysis': 'Analyse de l\'activité opérateur',
        'msp_audit_title': 'Journal d\'audit du prestataire',
        'msp_audit_intro': '{total} action(s) opérateur ciblant ce locataire enregistrée(s) dans Panoptica365.',
        'exemptions_title': 'Exemptions d\'alertes actives',
        'exemptions_intro': '{total} règle(s) d\'exemption active(s) résolvent automatiquement certains patterns d\'alertes pour ce locataire.',
        'exemptions_none': 'Aucune règle d\'exemption d\'alerte active pour ce locataire.',
        'activity_title': 'Volume d\'activité',
        'activity_intro': '{total} événements au total enregistrés sur l\'ensemble des politiques d\'alertes pendant la période.',
        'col_when': 'Quand', 'col_what': 'Quoi', 'col_who': 'Qui', 'col_setting': 'Paramètre',
        'col_event': 'Événement', 'col_priority': 'Priorité', 'col_category': 'Catégorie',
        'col_user': 'Utilisateur', 'col_count': 'Nombre', 'col_expires': 'Expire',
        'col_policy': 'Politique', 'col_total': 'Événements',
        'pri_critical': 'Critique', 'pri_high': 'Élevée', 'pri_medium': 'Moyenne', 'pri_low': 'Faible',
        'status_monitored': 'Conforme', 'status_drift': 'Dérive', 'status_not_applied': 'Non appliqué',
        'status_pending': 'En attente', 'status_poll_error': 'Erreur de scrutation', 'status_unavailable': 'Indisponible',
        'score_delta_up': 'amélioration de {delta} points',
        'score_delta_down': 'baisse de {delta} points',
        'score_delta_flat': 'inchangé',
        # ─── Report enrichment (Identity Hygiene + Application Risk) ───
        'er_sec_identity': 'Hygiène des identités',
        'er_sec_admins': 'Comptes avec rôles d\'administration',
        'er_sec_inactive': 'Comptes inactifs',
        'er_sec_breakglass': 'Compte d\'urgence (bris de glace)',
        'er_sec_app_risk': 'Risque applicatif',
        'er_sec_app_gov': 'Gouvernance des applications',
        'er_sec_known_good': 'Applications approuvées',
        'er_sec_other_apps': 'Autres applications',
        'er_col_account': 'Compte',
        'er_col_roles': 'Rôles',
        'er_col_enabled': 'Activé',
        'er_col_mfa': 'MFA',
        'er_col_activity': 'Dernière activité',
        'er_col_type': 'Type',
        'er_col_app': 'Application',
        'er_col_publisher': 'Éditeur',
        'er_col_verdict': 'Verdict de risque',
        'er_col_permissions': 'Autorisations',
        'er_col_drift': 'Dérive',
        'er_yes': 'Oui',
        'er_no': 'Non',
        'er_unknown': 'Inconnu',
        'er_member': 'Membre',
        'er_guest': 'Invité',
        'er_verdict_green': 'Vert',
        'er_verdict_yellow': 'Jaune',
        'er_verdict_red': 'Rouge',
        'er_verdict_none': 'Non évalué',
        'er_drift_yes': 'En dérive',
        'er_never_redeemed': 'Jamais accepté',
        'er_breakglass_tag': 'compte d\'urgence',
        'er_bg_group_label': 'Groupe',
        'er_bg_members_label': 'Membres',
        'er_none': 'Aucun',
        'er_more': '(+{n} de plus)',
        'er_no_admins': 'Aucun compte ne détient de rôle d\'administration.',
        'er_no_inactive': 'Aucun compte inactif.',
        'er_all_known_good': 'Toutes les applications sont approuvées.',
        'er_identity_unavailable': 'Les données de revue des accès n\'ont pas été recueillies pour ce locataire. Lancez une revue des accès pour renseigner l\'hygiène des identités.',
        'er_apps_unavailable': 'L\'inventaire des applications n\'est pas disponible. Lancez l\'analyse des applications.',
        'er_bg_not_configured': 'Aucun groupe de compte d\'urgence (bris de glace) n\'est configuré pour ce locataire.',
        'er_bg_members_unavailable': 'L\'appartenance au groupe n\'a pas pu être lue au moment du rapport.',
        'er_threshold_note': 'Seuil d\'inactivité : {n} jours.',
    },
    'es': {
        'report_title': 'Informe de Postura de Seguridad',
        'generated': 'Generado',
        'exec_summary': 'Resumen Ejecutivo',
        'secure_score': 'Microsoft Secure Score',
        'secure_score_label': 'Secure Score',
        'alert_overview': 'Resumen de Alertas',
        'alert_trend': 'Tendencia de Alertas',
        'security_highlights': 'Aspectos Destacados de Seguridad',
        'alert_analysis': 'Análisis de Alertas',
        'notable_incidents': 'Incidentes Notables',
        'recommendations': 'Recomendaciones',
        'alerts_recorded': 'Se registraron <b>{total}</b> alertas durante el período {range}.',
        'breakdown': 'Desglose',
        'severity': 'Severidad',
        'description': 'Descripción',
        'status': 'Estado',
        'date': 'Fecha',
        'footer_report': 'Informe de Postura de Seguridad',
        'footer_page': 'Página',
        'footer_generated': 'Generado',
        'footer_confidential_with_platform': 'Confidencial — Preparado por {msp} mediante Panoptica365 únicamente para destinatarios autorizados',
        'footer_confidential_no_platform': 'Confidencial — Preparado por {msp} únicamente para destinatarios autorizados',
        'cover_prepared_by': 'Preparado por {msp}',
        'ca_policies_title': 'Políticas de Acceso Condicional',
        'ca_policies_intro': 'Las siguientes políticas de Acceso Condicional están configuradas actualmente en este inquilino:',
        'ca_cross_analysis': 'Análisis Cruzado de Políticas',
        'settings_title': 'Postura de Configuración de Seguridad',
        'settings_intro': 'Panoptica365 supervisa {total} configuraciones de seguridad estándar frente a la línea base del cliente. El gráfico muestra el estado actual coincidente/desviado.',
        'settings_drifting_label': 'Configuraciones con Desviación',
        'settings_no_drift': 'Todas las configuraciones supervisadas coinciden actualmente con la línea base.',
        'settings_recent_label': 'Actividad Reciente de Configuraciones',
        'settings_analysis': 'Análisis de la Postura de Configuración',
        'defender_title': 'Incidentes de Microsoft Defender XDR',
        'defender_intro': 'Se abrieron o actualizaron {total} incidente(s) en Microsoft Defender XDR durante este período.',
        'defender_no_incidents': 'No se observaron incidentes de Microsoft Defender XDR durante este período.',
        'defender_analysis': 'Análisis de Incidentes de Defender',
        'change_log_title': 'Actividad del Operador (Registro de Cambios)',
        'change_log_intro': 'Su MSP realizó {total} cambio(s) registrado(s) en este inquilino durante el período.',
        'change_log_none': 'No se registraron cambios del operador para este inquilino durante el período.',
        'change_log_analysis': 'Análisis de la Actividad del Operador',
        'msp_audit_title': 'Registro de Auditoría del MSP',
        'msp_audit_intro': 'Se registraron {total} acción(es) del operador dirigidas a este inquilino en Panoptica365.',
        'exemptions_title': 'Exenciones de Alertas Activas',
        'exemptions_intro': '{total} regla(s) de exención activa(s) resuelven automáticamente patrones de alertas específicos para este inquilino.',
        'exemptions_none': 'No hay reglas de exención de alertas activas configuradas para este inquilino.',
        'activity_title': 'Volumen de Actividad',
        'activity_intro': 'Se registraron {total} eventos totales en todas las políticas de alertas durante el período.',
        'col_when': 'Cuándo', 'col_what': 'Qué', 'col_who': 'Quién', 'col_setting': 'Configuración',
        'col_event': 'Evento', 'col_priority': 'Prioridad', 'col_category': 'Categoría',
        'col_user': 'Usuario', 'col_count': 'Conteo', 'col_expires': 'Expira',
        'col_policy': 'Política', 'col_total': 'Eventos',
        'pri_critical': 'Crítica', 'pri_high': 'Alta', 'pri_medium': 'Media', 'pri_low': 'Baja',
        'status_monitored': 'Coincide', 'status_drift': 'Desviación', 'status_not_applied': 'No Aplicada',
        'status_pending': 'Pendiente', 'status_poll_error': 'Error de Sondeo', 'status_unavailable': 'No Disponible',
        'score_delta_up': 'mejoró en {delta} puntos',
        'score_delta_down': 'disminuyó en {delta} puntos',
        'score_delta_flat': 'sin cambios',
        # ─── Report enrichment (Identity Hygiene + Application Risk) ───
        'er_sec_identity': 'Higiene de identidades',
        'er_sec_admins': 'Cuentas con roles de administrador',
        'er_sec_inactive': 'Cuentas inactivas',
        'er_sec_breakglass': 'Acceso de emergencia (break-glass)',
        'er_sec_app_risk': 'Riesgo de aplicaciones',
        'er_sec_app_gov': 'Gobernanza de aplicaciones',
        'er_sec_known_good': 'Aplicaciones aprobadas',
        'er_sec_other_apps': 'Otras aplicaciones',
        'er_col_account': 'Cuenta',
        'er_col_roles': 'Roles',
        'er_col_enabled': 'Habilitado',
        'er_col_mfa': 'MFA',
        'er_col_activity': 'Última actividad',
        'er_col_type': 'Tipo',
        'er_col_app': 'Aplicación',
        'er_col_publisher': 'Editor',
        'er_col_verdict': 'Veredicto de riesgo',
        'er_col_permissions': 'Permisos',
        'er_col_drift': 'Desviación',
        'er_yes': 'Sí',
        'er_no': 'No',
        'er_unknown': 'Desconocido',
        'er_member': 'Miembro',
        'er_guest': 'Invitado',
        'er_verdict_green': 'Verde',
        'er_verdict_yellow': 'Amarillo',
        'er_verdict_red': 'Rojo',
        'er_verdict_none': 'Sin evaluar',
        'er_drift_yes': 'Desviada',
        'er_never_redeemed': 'Nunca aceptada',
        'er_breakglass_tag': 'break-glass',
        'er_bg_group_label': 'Grupo',
        'er_bg_members_label': 'Miembros',
        'er_none': 'Ninguno',
        'er_more': '(+{n} más)',
        'er_no_admins': 'Ninguna cuenta tiene roles de administrador.',
        'er_no_inactive': 'Ninguna cuenta inactiva.',
        'er_all_known_good': 'Todas las aplicaciones están aprobadas.',
        'er_identity_unavailable': 'No se han recopilado datos de revisión de acceso para este inquilino. Ejecute una revisión de acceso para completar la higiene de identidades.',
        'er_apps_unavailable': 'El inventario de aplicaciones no está disponible. Ejecute el análisis de aplicaciones.',
        'er_bg_not_configured': 'No hay configurado ningún grupo de acceso de emergencia (break-glass) para este inquilino.',
        'er_bg_members_unavailable': 'No se pudo leer la pertenencia al grupo al momento del informe.',
        'er_threshold_note': 'Umbral de inactividad: {n} días.',
    }
}


def load_input(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_strings(lang):
    return STRINGS.get(lang, STRINGS['en'])


def get_severity_labels(lang):
    if lang == 'fr':
        return SEVERITY_LABELS_FR
    if lang == 'es':
        return SEVERITY_LABELS_ES
    return SEVERITY_LABELS


def create_styles():
    """Create custom paragraph styles for the report."""
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading1'],
        fontSize=16,
        leading=20,
        textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold',
        spaceBefore=20,
        spaceAfter=10,
        borderPadding=(0, 0, 4, 0),
    ))

    styles.add(ParagraphStyle(
        'SubHeading',
        parent=styles['Heading2'],
        fontSize=12,
        leading=16,
        textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold',
        spaceBefore=10,
        spaceAfter=6,
    ))

    styles.add(ParagraphStyle(
        'ReportBody',
        parent=styles['Normal'],
        fontSize=10,
        leading=15,
        textColor=HexColor(COLORS['text']),
        fontName='Helvetica',
        alignment=TA_JUSTIFY,
        spaceAfter=8,
    ))

    styles.add(ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=HexColor(COLORS['text']),
        fontName='Helvetica',
        wordWrap='CJK',
    ))

    styles.add(ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold',
    ))

    return styles


def generate_severity_chart(alerts_by_severity, output_buf, sev_labels):
    """Horizontal bar chart of alert counts by severity."""
    labels = []
    values = []
    colors = []

    for sev in SEVERITY_ORDER:
        cnt = alerts_by_severity.get(sev, 0)
        labels.append(sev_labels.get(sev, sev))
        values.append(cnt)
        colors.append(SEVERITY_COLORS.get(sev, '#999999'))

    fig, ax = plt.subplots(figsize=(5.5, 2.2))
    bars = ax.barh(labels, values, color=colors, height=0.55, edgecolor='none')

    ax.set_xlim(0, max(values) * 1.15 if max(values) > 0 else 1)
    ax.invert_yaxis()
    ax.set_xlabel('')
    ax.xaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#CCCCCC')
    ax.spines['left'].set_visible(False)
    ax.tick_params(axis='y', length=0, labelsize=9)
    ax.tick_params(axis='x', labelsize=8, colors='#666666')

    for bar, val in zip(bars, values):
        if val > 0:
            ax.text(bar.get_width() + max(values) * 0.02, bar.get_y() + bar.get_height() / 2,
                    str(val), va='center', ha='left', fontsize=9, fontweight='bold',
                    color='#333333')

    plt.tight_layout()
    fig.savefig(output_buf, format='png', dpi=150, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)


def generate_trend_chart(trend_data, output_buf, sev_labels):
    """Stacked bar chart of daily alert counts by severity."""
    if not trend_data:
        return False

    days = sorted(set(r['day'] for r in trend_data))
    if len(days) < 2:
        return False

    day_labels = [d[5:] if isinstance(d, str) else d.strftime('%m-%d') for d in days]

    severity_data = {}
    for sev in SEVERITY_ORDER:
        severity_data[sev] = []
        for day in days:
            cnt = sum(r['count'] for r in trend_data if r['day'] == day and r['severity'] == sev)
            severity_data[sev].append(cnt)

    fig, ax = plt.subplots(figsize=(5.5, 2.2))

    bottom = [0] * len(days)
    for sev in reversed(SEVERITY_ORDER):
        vals = severity_data[sev]
        if sum(vals) > 0:
            ax.bar(range(len(days)), vals, bottom=bottom,
                   color=SEVERITY_COLORS[sev], label=sev_labels[sev],
                   width=0.7, edgecolor='none')
            bottom = [b + v for b, v in zip(bottom, vals)]

    ax.set_xticks(range(len(days)))
    ax.set_xticklabels(day_labels, rotation=45, ha='right', fontsize=7)
    ax.yaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#CCCCCC')
    ax.spines['left'].set_color('#CCCCCC')
    ax.tick_params(axis='y', labelsize=8, colors='#666666')
    ax.legend(fontsize=7, loc='upper center', bbox_to_anchor=(0.5, -0.32),
              ncol=5, frameon=False)

    fig.subplots_adjust(bottom=0.35)
    fig.savefig(output_buf, format='png', dpi=150, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    return True


def generate_secure_score_gauge(score_pct, output_buf, label_text='Secure Score'):
    """Donut gauge for the secure score."""
    if score_pct is None:
        return False

    fig, ax = plt.subplots(figsize=(2.5, 2.5))

    remaining = 100 - score_pct
    colors_list = ['#33CC66' if score_pct >= 80 else '#FFAA00' if score_pct >= 60 else '#FF3232', '#E8E8E8']
    wedges, _ = ax.pie([score_pct, remaining], colors=colors_list,
                       startangle=90, counterclock=False,
                       wedgeprops=dict(width=0.3, edgecolor='white', linewidth=2))

    ax.text(0, 0.05, f'{score_pct:.1f}%', ha='center', va='center',
            fontsize=20, fontweight='bold', color='#2C3E50')
    ax.text(0, -0.22, label_text, ha='center', va='center',
            fontsize=8, color='#666666')

    plt.tight_layout()
    fig.savefig(output_buf, format='png', dpi=150, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    return True


def generate_settings_chart(by_status, output_buf, s):
    """Donut chart of security settings by status (matched/drift/etc)."""
    if not by_status:
        return False

    # Order matters: matched first (positive), drift last (most attention)
    order = [
        ('monitored', s.get('status_monitored', 'Matched'), COLORS['matched']),
        ('not_applied', s.get('status_not_applied', 'Not Applied'), COLORS['unavailable']),
        ('pending', s.get('status_pending', 'Pending'), COLORS['pending']),
        ('poll_error', s.get('status_poll_error', 'Poll Error'), COLORS['high']),
        ('unavailable', s.get('status_unavailable', 'Unavailable'), '#bbbbbb'),
        ('drift', s.get('status_drift', 'Drift'), COLORS['drift']),
    ]
    labels = []
    values = []
    colors_list = []
    for key, label, color in order:
        cnt = by_status.get(key, 0)
        if cnt > 0:
            labels.append(f'{label} ({cnt})')
            values.append(cnt)
            colors_list.append(color)

    if not values:
        return False

    # Source PNG ratio MUST match the RLImage embed ratio (4.5"w x 2.4"h ≈ 1.875)
    # otherwise ReportLab stretches the image and the donut becomes oval.
    # Strategy: figure is 4.5x2.4 to match embed, pie axes is forced square
    # (height-bound, since 2.4" < 4.5") and centered-left, legend gets the
    # rest of the figure on the right.
    fig = plt.figure(figsize=(4.5, 2.4))
    # Pie axes: square 2.16" x 2.16" anchored top-left of figure. With figure
    # 4.5x2.4, fractions [0.02, 0.05, 0.48, 0.90] → 2.16x2.16 inches → square.
    ax = fig.add_axes([0.02, 0.05, 0.48, 0.90])
    ax.set_aspect('equal')
    total = sum(values)

    wedges, _ = ax.pie(
        values, colors=colors_list, startangle=90, counterclock=False,
        wedgeprops=dict(width=0.32, edgecolor='white', linewidth=2),
    )

    # Center text — total + label
    ax.text(0, 0.06, str(total), ha='center', va='center',
            fontsize=20, fontweight='bold', color=COLORS['primary'])
    ax.text(0, -0.18, 'settings', ha='center', va='center',
            fontsize=8, color=COLORS['text_light'])

    # Legend on the right — own axes
    legend_ax = fig.add_axes([0.55, 0.05, 0.43, 0.90])
    legend_ax.axis('off')
    legend_ax.legend(wedges, labels, loc='center left', fontsize=8, frameon=False)

    # No bbox_inches='tight' — that would shrink the canvas and break the
    # source-PNG-to-embed-box aspect match.
    fig.savefig(output_buf, format='png', dpi=150,
                facecolor='white', edgecolor='none')
    plt.close(fig)
    return True


def generate_activity_chart(daily_totals, output_buf):
    """Line/bar chart of daily activity volume."""
    if not daily_totals or len(daily_totals) < 2:
        return False

    days = [r['day'] for r in daily_totals]
    values = [r['total'] for r in daily_totals]
    day_labels = [d[5:] if isinstance(d, str) else d.strftime('%m-%d') for d in days]

    fig, ax = plt.subplots(figsize=(5.5, 2.0))
    ax.fill_between(range(len(days)), values, color=COLORS['primary'], alpha=0.18)
    ax.plot(range(len(days)), values, color=COLORS['primary'], linewidth=1.6, marker='o', markersize=3)

    ax.set_xticks(range(len(days)))
    ax.set_xticklabels(day_labels, rotation=45, ha='right', fontsize=7)
    ax.yaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#CCCCCC')
    ax.spines['left'].set_color('#CCCCCC')
    ax.tick_params(axis='y', labelsize=8, colors='#666666')

    fig.subplots_adjust(bottom=0.30)
    fig.savefig(output_buf, format='png', dpi=150, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    return True


class ReportPageTemplate:
    """Custom page template with footer and decorative elements."""

    def __init__(self, tenant_name, range_label, strings, footer_text):
        self.tenant_name = tenant_name
        self.range_label = range_label
        self.s = strings
        self.footer_text = footer_text

    def on_page(self, canvas_obj, doc):
        canvas_obj.saveState()
        width, height = letter

        # Top accent line
        canvas_obj.setStrokeColor(HexColor(COLORS['accent']))
        canvas_obj.setLineWidth(2)
        canvas_obj.line(54, height - 45, width - 54, height - 45)

        # Footer
        canvas_obj.setFont('Helvetica', 7)
        canvas_obj.setFillColor(HexColor(COLORS['text_light']))
        canvas_obj.drawString(54, 30,
                              f"{self.tenant_name} — {self.s['footer_report']} — {self.range_label}")
        canvas_obj.drawRightString(width - 54, 30,
                                   f"{self.s['footer_page']} {doc.page} — {self.s['footer_generated']} {datetime.now().strftime('%Y-%m-%d %H:%M')}")

        # Footer line
        canvas_obj.setStrokeColor(HexColor(COLORS['border']))
        canvas_obj.setLineWidth(0.5)
        canvas_obj.line(54, 42, width - 54, 42)

        # Confidential strip — built from reportConfig (mspName + platformAttribution)
        canvas_obj.setFont('Helvetica', 6)
        canvas_obj.setFillColor(HexColor(COLORS['text_light']))
        canvas_obj.drawCentredString(width / 2, 18, self.footer_text)

        canvas_obj.restoreState()


import re as _re

# Sonnet emits markdown bold/italic in narrative output. ReportLab Paragraph
# parses HTML-like tags but not markdown, so `**bold**` would render as literal
# asterisks. Convert before rendering. Order matters: double-asterisk first to
# avoid greedy single-asterisk matching swallowing the inner pair.
_MD_BOLD = _re.compile(r'\*\*(.+?)\*\*', flags=_re.DOTALL)
_MD_ITALIC_AST = _re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', flags=_re.DOTALL)
_MD_ITALIC_USC = _re.compile(r'(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)')


def _markdown_to_html(text):
    """Best-effort markdown → ReportLab HTML conversion (bold + italic only)."""
    if not text:
        return text
    text = _MD_BOLD.sub(r'<b>\1</b>', text)
    text = _MD_ITALIC_AST.sub(r'<i>\1</i>', text)
    text = _MD_ITALIC_USC.sub(r'<i>\1</i>', text)
    return text


def text_to_paras(text, styles):
    paras = []
    if text:
        for chunk in text.split('\n\n'):
            chunk = chunk.strip()
            if chunk:
                paras.append(Paragraph(_markdown_to_html(chunk), styles['ReportBody']))
    return paras


def section_line(width):
    t = Table([['']], colWidths=[width - 108], rowHeights=[1])
    t.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
    ]))
    return t


def build_section(title, paragraphs, styles, width, story):
    """Add a section heading + first paragraph kept together to avoid orphans."""
    heading = Paragraph(title, styles['SectionHeading'])
    line = section_line(width)
    if paragraphs:
        first_group = KeepTogether([heading, Spacer(1, 4), line, Spacer(1, 8), paragraphs[0]])
        story.append(first_group)
        for p in paragraphs[1:]:
            story.append(p)
    else:
        story.append(KeepTogether([heading, Spacer(1, 4), line]))
    story.append(Spacer(1, 6))


def build_pdf(data, output_path):
    """Main PDF assembly function."""
    styles = create_styles()
    story = []
    width, height = letter

    tenant_name = data.get('tenant', {}).get('display_name', 'Unknown Tenant')
    range_label = data.get('rangeLabel', 'Last 30 Days')
    narrative = data.get('narrative', {})
    alerts = data.get('alerts', {})
    secure_score = data.get('secureScore', None)
    secure_score_delta = data.get('secureScoreDelta', None)
    settings_data = data.get('securitySettings', {}) or {}
    defender = data.get('defenderIncidents', {}) or {}
    change_log = data.get('changeLog', {}) or {}
    msp_audit = data.get('mspAudit', {}) or {}
    exemptions = data.get('exemptions', {}) or {}
    activity = data.get('activity', {}) or {}
    lang = data.get('language', 'en')

    s = get_strings(lang)
    sev_labels = get_severity_labels(lang)

    # Build footer string from reportConfig (mspName + platformAttribution).
    # May 20, 2026 — brand-neutral fallback. When mspName is empty (no
    # MSP_NAME env var set in the originating deployment), use the platform
    # brand name. The originating MSP install can override via MSP_NAME.
    rc = data.get('reportConfig', {}) or {}
    msp_name = rc.get('mspName') or 'Panoptica365'
    platform_attr = rc.get('platformAttribution', True)
    # Cover "Prepared by" line: the logged-in operator's name when the report
    # route supplies it (a salesperson wants their own name on a customer
    # printout), falling back to the MSP name for unattended/scheduled runs.
    prepared_by = rc.get('preparedBy') or msp_name
    footer_template = s['footer_confidential_with_platform'] if platform_attr else s['footer_confidential_no_platform']
    footer_text = footer_template.format(msp=msp_name)

    # Cover image: canonical Panoptica365 cover. Falls back to legacy assets.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    cover_canonical = os.path.join(project_root, 'public', 'img', 'report-cover.png')
    cover_v2_legacy  = os.path.join(project_root, 'dev', 'Panoptica', 'Posture Report-v2.png')
    cover_v1_legacy  = os.path.join(project_root, 'dev', 'Panoptica', 'Posture Report.png')
    if os.path.exists(cover_canonical):
        cover_image_path = cover_canonical
    elif os.path.exists(cover_v2_legacy):
        cover_image_path = cover_v2_legacy
    else:
        cover_image_path = cover_v1_legacy

    # Optional MSP branding logo. Uploaded via Settings → Report Branding and
    # stored at data/branding/logo.png (a transparent PNG). Drawn top-left on
    # the cover when present; absent = no logo, text block shifts up.
    msp_logo_path = os.path.join(project_root, 'data', 'branding', 'logo.png')
    if not os.path.exists(msp_logo_path):
        msp_logo_path = None

    template = ReportPageTemplate(tenant_name, range_label, s, footer_text)

    # ─── Generate charts as PNG buffers ───
    severity_chart_buf = BytesIO()
    generate_severity_chart(alerts.get('bySeverity', {}), severity_chart_buf, sev_labels)
    severity_chart_buf.seek(0)

    trend_chart_buf = BytesIO()
    has_trend = generate_trend_chart(alerts.get('trend', []), trend_chart_buf, sev_labels)
    if has_trend:
        trend_chart_buf.seek(0)

    score_gauge_buf = BytesIO()
    score_pct = None
    if secure_score:
        score_pct = secure_score.get('percentage') or secure_score.get('currentScore')
        if score_pct is not None:
            try:
                score_pct = float(score_pct)
            except (ValueError, TypeError):
                score_pct = None
    has_gauge = generate_secure_score_gauge(score_pct, score_gauge_buf, s['secure_score_label']) if score_pct else False
    if has_gauge:
        score_gauge_buf.seek(0)

    settings_chart_buf = BytesIO()
    has_settings_chart = generate_settings_chart(settings_data.get('byStatus', {}), settings_chart_buf, s)
    if has_settings_chart:
        settings_chart_buf.seek(0)

    activity_chart_buf = BytesIO()
    has_activity_chart = generate_activity_chart(activity.get('dailyTotals', []), activity_chart_buf)
    if has_activity_chart:
        activity_chart_buf.seek(0)

    # ─── Document setup ───
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=60,
        bottomMargin=54,
        title=f'{tenant_name} — {s["report_title"]}',
        author='Panoptica365',
    )

    # ── Executive Summary ──
    build_section(s['exec_summary'], text_to_paras(narrative.get('executive_summary', ''), styles),
                  styles, width, story)

    # ── Secure Score (with optional delta sentence) ──
    if has_gauge or score_pct is not None:
        heading = Paragraph(s['secure_score'], styles['SectionHeading'])
        line = section_line(width)
        score_elements = [heading, Spacer(1, 4), line, Spacer(1, 8)]

        # Build score analysis text. If we have a delta, prepend a one-liner.
        score_text = narrative.get('secure_score_analysis', '')
        if secure_score_delta:
            d = secure_score_delta.get('delta_pct', 0)
            try:
                d = float(d)
            except Exception:
                d = 0
            if abs(d) < 0.05:
                delta_sentence = s['score_delta_flat']
            elif d > 0:
                delta_sentence = s['score_delta_up'].format(delta=f'{d:+.1f}'.lstrip('+'))
            else:
                delta_sentence = s['score_delta_down'].format(delta=f'{abs(d):.1f}')
            # Prepend as a small italic line under the gauge
            score_text = f'<i>{delta_sentence}</i>\n\n' + (score_text or '')

        if has_gauge:
            score_img = RLImage(score_gauge_buf, width=2 * inch, height=2 * inch)
            if score_text:
                score_paras = text_to_paras(score_text, styles)
                text_flowables = score_paras if score_paras else [Spacer(1, 1)]
                score_table = Table(
                    [[score_img, text_flowables]],
                    colWidths=[2.2 * inch, width - 108 - 2.4 * inch],
                )
                score_table.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ]))
                score_elements.append(score_table)
            else:
                score_elements.append(score_img)
        else:
            score_elements.extend(text_to_paras(score_text, styles))

        story.append(KeepTogether(score_elements))
        story.append(Spacer(1, 6))

    # ── Alert Overview ──
    total_alerts = alerts.get('total', 0)
    by_sev = alerts.get('bySeverity', {})
    summary_text = s['alerts_recorded'].format(total=total_alerts, range=range_label.lower())
    sev_parts = []
    for sev in SEVERITY_ORDER:
        cnt = by_sev.get(sev, 0)
        if cnt > 0:
            color = SEVERITY_COLORS[sev]
            label = sev_labels[sev]
            sev_parts.append(f'<font color="{color}"><b>{cnt} {label}</b></font>')
    if sev_parts:
        summary_text += f' {s["breakdown"]}: ' + ', '.join(sev_parts) + '.'

    alert_overview_paras = [Paragraph(summary_text, styles['ReportBody']), Spacer(1, 8)]
    if total_alerts > 0:
        sev_chart_img = RLImage(severity_chart_buf, width=4.5 * inch, height=1.8 * inch)
        alert_overview_paras.append(sev_chart_img)
    build_section(s['alert_overview'], alert_overview_paras, styles, width, story)

    # Trend chart if available
    if has_trend:
        trend_img = RLImage(trend_chart_buf, width=5 * inch, height=2 * inch)
        build_section(s['alert_trend'], [trend_img], styles, width, story)

    # ── Security Highlights ──
    highlights = narrative.get('security_highlights', '')
    if highlights:
        build_section(s['security_highlights'], text_to_paras(highlights, styles), styles, width, story)

    # ── Alert Analysis ──
    analysis = narrative.get('alert_analysis', '')
    if analysis:
        build_section(s['alert_analysis'], text_to_paras(analysis, styles), styles, width, story)

    # ── Notable Incidents Table ──
    top_alerts = alerts.get('topAlerts', [])
    if top_alerts:
        heading = Paragraph(s['notable_incidents'], styles['SectionHeading'])
        line = section_line(width)
        header_row = [
            Paragraph(s['severity'], styles['TableHeader']),
            Paragraph(s['description'], styles['TableHeader']),
            Paragraph(s['status'], styles['TableHeader']),
            Paragraph(s['date'], styles['TableHeader']),
        ]
        table_data = [header_row]
        for a in top_alerts[:10]:
            sev = a.get('severity', 'info')
            sev_label_text = sev_labels.get(sev, sev)
            msg = a.get('message', '')
            status = localize(a.get('status', ''), STATUS_LABELS, lang)
            date = (a.get('triggered_at', '') or '')[:10]
            table_data.append([
                Paragraph(sev_label_text, styles['TableCell']),
                Paragraph(msg, styles['TableCell']),
                Paragraph(status, styles['TableCell']),
                Paragraph(date, styles['TableCell']),
            ])

        t = Table(table_data, colWidths=[60, 280, 70, 70])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(KeepTogether([heading, Spacer(1, 4), line, Spacer(1, 8), t]))
        story.append(Spacer(1, 12))

    # ── Security Settings Posture ──
    if settings_data.get('total'):
        story.append(PageBreak())
        intro = Paragraph(
            s['settings_intro'].format(total=settings_data.get('total', 0)),
            styles['ReportBody']
        )
        sec_paras = [intro]
        if has_settings_chart:
            sec_paras.append(Spacer(1, 6))
            sec_paras.append(RLImage(settings_chart_buf, width=4.5 * inch, height=2.4 * inch))
        build_section(s['settings_title'], sec_paras, styles, width, story)

        # Settings posture analysis (narrative)
        sp_text = narrative.get('settings_posture_analysis', '')
        if sp_text:
            story.append(Paragraph(s['settings_analysis'], styles['SubHeading']))
            for p in text_to_paras(sp_text, styles):
                story.append(p)

        # Drifting settings table (if any)
        drifting = settings_data.get('drifting', [])
        if drifting:
            story.append(Paragraph(s['settings_drifting_label'], styles['SubHeading']))
            header_row = [
                Paragraph(s['col_priority'], styles['TableHeader']),
                Paragraph(s['col_setting'], styles['TableHeader']),
                Paragraph(s['col_category'], styles['TableHeader']),
            ]
            rows = [header_row]
            pri_label_map = {
                'critical': s['pri_critical'], 'high': s['pri_high'],
                'medium': s['pri_medium'], 'low': s['pri_low'],
            }
            for d in drifting[:25]:
                pri = pri_label_map.get(d.get('priority', ''), d.get('priority', ''))
                # Setting NAME only — never the internal ID (EXO-09 etc.)
                # in customer-facing tables. ID is operator-only and lives in
                # the audit log, not the report.
                rows.append([
                    Paragraph(pri, styles['TableCell']),
                    Paragraph(d.get('name', '') or '', styles['TableCell']),
                    Paragraph(localize(d.get('category', ''), SETTING_CATEGORY_LABELS, lang), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[60, 320, 100])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))
        elif settings_data.get('total'):
            story.append(Paragraph(s['settings_no_drift'], styles['ReportBody']))

        # Recent setting events (last 10)
        recent_events = settings_data.get('recentEvents', [])
        if recent_events:
            story.append(Paragraph(s['settings_recent_label'], styles['SubHeading']))
            header_row = [
                Paragraph(s['col_when'], styles['TableHeader']),
                Paragraph(s['col_event'], styles['TableHeader']),
                Paragraph(s['col_setting'], styles['TableHeader']),
                Paragraph(s['col_who'], styles['TableHeader']),
            ]
            rows = [header_row]
            for e in recent_events[:10]:
                # Setting NAME only — same rule as the drifting-settings table.
                rows.append([
                    Paragraph((e.get('created_at', '') or '')[:16], styles['TableCell']),
                    Paragraph(localize(e.get('event_type', ''), SETTING_EVENT_LABELS, lang), styles['TableCell']),
                    Paragraph(e.get('name', '') or '', styles['TableCell']),
                    Paragraph(e.get('operator_email', '') or 'system', styles['TableCell']),
                ])
            t = Table(rows, colWidths=[80, 80, 240, 100])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Defender XDR Incidents ──
    if defender.get('total') or narrative.get('defender_incidents_analysis'):
        if defender.get('total'):
            intro_text = s['defender_intro'].format(total=defender.get('total', 0))
        else:
            intro_text = s['defender_no_incidents']

        build_section(s['defender_title'], [Paragraph(intro_text, styles['ReportBody'])],
                      styles, width, story)

        di_text = narrative.get('defender_incidents_analysis', '')
        if di_text:
            for p in text_to_paras(di_text, styles):
                story.append(p)

        top_inc = defender.get('top', [])
        if top_inc:
            header_row = [
                Paragraph(s['severity'], styles['TableHeader']),
                Paragraph(s['description'], styles['TableHeader']),
                Paragraph(s['status'], styles['TableHeader']),
                Paragraph(s['col_count'], styles['TableHeader']),
                Paragraph(s['date'], styles['TableHeader']),
            ]
            rows = [header_row]
            for inc in top_inc[:8]:
                # Defender severity values: informational/low/medium/high — use the same severity labels as alerts
                inc_sev_raw = (inc.get('severity', '') or '').lower()
                inc_sev_lookup = 'info' if inc_sev_raw == 'informational' else inc_sev_raw
                inc_sev = sev_labels.get(inc_sev_lookup, inc.get('severity', '') or '-')
                # Defender status values: active/resolved/redirected/inProgress
                inc_status_raw = (inc.get('status', '') or '').lower()
                if inc_status_raw == 'inprogress':
                    inc_status_raw = 'in_progress'
                inc_status = localize(inc_status_raw, STATUS_LABELS, lang) if inc_status_raw in STATUS_LABELS['en'] else (inc.get('status', '') or '-')
                rows.append([
                    Paragraph(inc_sev, styles['TableCell']),
                    Paragraph(inc.get('display_name', '') or inc.get('incident_id', '') or '-', styles['TableCell']),
                    Paragraph(inc_status, styles['TableCell']),
                    Paragraph(str(inc.get('alerts_count', 0)), styles['TableCell']),
                    Paragraph((inc.get('last_updated_at_utc', '') or '')[:10], styles['TableCell']),
                ])
            t = Table(rows, colWidths=[60, 250, 70, 50, 70])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Operator Activity (Tenant Change Log) ──
    if change_log.get('total') or narrative.get('operator_activity_analysis'):
        if change_log.get('total'):
            intro_text = s['change_log_intro'].format(total=change_log.get('total', 0))
        else:
            intro_text = s['change_log_none']
        build_section(s['change_log_title'], [Paragraph(intro_text, styles['ReportBody'])],
                      styles, width, story)

        oa_text = narrative.get('operator_activity_analysis', '')
        if oa_text:
            for p in text_to_paras(oa_text, styles):
                story.append(p)

        recent_changes = change_log.get('recent', [])
        if recent_changes:
            header_row = [
                Paragraph(s['col_when'], styles['TableHeader']),
                Paragraph(s['col_category'], styles['TableHeader']),
                Paragraph(s['description'], styles['TableHeader']),
                Paragraph(s['col_who'], styles['TableHeader']),
            ]
            rows = [header_row]
            for c in recent_changes[:15]:
                desc = c.get('description', '') or ''
                surface = c.get('surface', '')
                if isinstance(surface, list):
                    surface = ','.join(surface)
                cat_loc = localize(c.get('category', ''), CHANGE_CATEGORY_LABELS, lang)
                rows.append([
                    Paragraph((c.get('started_at', '') or '')[:16], styles['TableCell']),
                    Paragraph(cat_loc, styles['TableCell']),
                    Paragraph(f"{desc}<br/><font color='#888'>({surface}, {c.get('impact','')})</font>" if desc else f"({surface}, {c.get('impact','')})", styles['TableCell']),
                    Paragraph(c.get('created_by', '') or c.get('source', ''), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[80, 90, 230, 100])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Identity Hygiene (enrichment: admins / inactive / break-glass) ──
    enrichment = data.get('enrichment') or {}
    identity = enrichment.get('identity') or {}
    breakglass = enrichment.get('breakGlass') or {}
    apps = enrichment.get('apps') or {}

    def _er_yesno(val):
        return s['er_yes'] if val else s['er_no']

    def _er_mfa(val):
        if val == 'yes':
            return s['er_yes']
        if val == 'no':
            return s['er_no']
        return s['er_unknown']

    def _er_activity(item):
        last = item.get('lastActivity')
        if last:
            return str(last)
        if item.get('neverRedeemed'):
            return s['er_never_redeemed']
        return '—'

    def _er_verdict(val):
        return {
            'green': s['er_verdict_green'],
            'yellow': s['er_verdict_yellow'],
            'red': s['er_verdict_red'],
        }.get(val, s['er_verdict_none'])

    def _er_drift(val):
        return s['er_drift_yes'] if val == 'drifted' else '—'

    def _er_join(lst):
        items = [str(x) for x in (lst or []) if x]
        return ', '.join(items) if items else '—'

    def _er_perms(lst):
        # Cap the permissions shown in a table cell — ReportLab cannot split a
        # single row across pages, so an app with a very large consent (e.g. a
        # broadly-permissioned monitoring/first-party app) would otherwise make
        # a row taller than the page and crash the build. Full list lives in the
        # Applications tab + CSV export.
        items = [str(x) for x in (lst or []) if x]
        if not items:
            return '—'
        limit = 20
        if len(items) > limit:
            return ', '.join(items[:limit]) + ' ' + s['er_more'].replace('{n}', str(len(items) - limit))
        return ', '.join(items)

    # Identity Hygiene section heading + narrative
    id_narrative = (narrative.get('identity_hygiene_analysis') or '').strip()
    build_section(s['er_sec_identity'], text_to_paras(id_narrative, styles) if id_narrative else [],
                  styles, width, story)

    if not identity.get('available'):
        story.append(Paragraph(s['er_identity_unavailable'], styles['ReportBody']))
        story.append(Spacer(1, 10))
    else:
        # Admin accounts table
        admins = identity.get('admins') or []
        admin_heading = Paragraph(s['er_sec_admins'], styles['SubHeading'])
        if admins:
            header_row = [
                Paragraph(s['er_col_account'], styles['TableHeader']),
                Paragraph(s['er_col_roles'], styles['TableHeader']),
                Paragraph(s['er_col_enabled'], styles['TableHeader']),
                Paragraph(s['er_col_mfa'], styles['TableHeader']),
                Paragraph(s['er_col_activity'], styles['TableHeader']),
            ]
            rows = [header_row]
            for a in admins:
                account = a.get('account') or a.get('upn') or '—'
                if a.get('breakGlass'):
                    account = f"{account} ({s['er_breakglass_tag']})"
                rows.append([
                    Paragraph(account, styles['TableCell']),
                    Paragraph(_er_join(a.get('roles')), styles['TableCell']),
                    Paragraph(_er_yesno(a.get('enabled')), styles['TableCell']),
                    Paragraph(_er_mfa(a.get('mfa')), styles['TableCell']),
                    Paragraph(_er_activity(a), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[140, 150, 50, 50, 100])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(KeepTogether([admin_heading, Spacer(1, 4), t]))
        else:
            story.append(KeepTogether([admin_heading, Spacer(1, 4),
                                       Paragraph(s['er_no_admins'], styles['ReportBody'])]))
        story.append(Spacer(1, 10))

        # Inactive accounts table
        inactive = identity.get('inactive_users') or []
        inactive_heading = Paragraph(s['er_sec_inactive'], styles['SubHeading'])
        threshold_n = identity.get('threshold_days')
        note_line = Paragraph(
            s['er_threshold_note'].replace('{n}', str(threshold_n)),
            styles['ReportBody']
        ) if threshold_n is not None else Spacer(1, 0)
        if inactive:
            header_row = [
                Paragraph(s['er_col_account'], styles['TableHeader']),
                Paragraph(s['er_col_type'], styles['TableHeader']),
                Paragraph(s['er_col_activity'], styles['TableHeader']),
            ]
            rows = [header_row]
            for u in inactive:
                account = u.get('account') or u.get('upn') or '—'
                utype = s['er_guest'] if u.get('type') == 'guest' else s['er_member']
                rows.append([
                    Paragraph(account, styles['TableCell']),
                    Paragraph(utype, styles['TableCell']),
                    Paragraph(_er_activity(u), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[250, 80, 160])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(KeepTogether([inactive_heading, Spacer(1, 4), note_line, Spacer(1, 4), t]))
        else:
            story.append(KeepTogether([inactive_heading, Spacer(1, 4), note_line, Spacer(1, 4),
                                       Paragraph(s['er_no_inactive'], styles['ReportBody'])]))
        story.append(Spacer(1, 10))

        # Break-glass block
        bg_heading = Paragraph(s['er_sec_breakglass'], styles['SubHeading'])
        bg_flowables = [bg_heading, Spacer(1, 4)]
        if not breakglass.get('configured'):
            bg_flowables.append(Paragraph(s['er_bg_not_configured'], styles['ReportBody']))
        else:
            group_name = breakglass.get('group_name') or s['er_none']
            bg_flowables.append(Paragraph(
                f"<b>{s['er_bg_group_label']}:</b> {group_name}", styles['ReportBody']))
            if not breakglass.get('members_available'):
                bg_flowables.append(Paragraph(s['er_bg_members_unavailable'], styles['ReportBody']))
            else:
                members = breakglass.get('members') or []
                member_names = [m.get('account') or m.get('upn') or '—' for m in members]
                member_str = ', '.join(member_names) if member_names else s['er_none']
                bg_flowables.append(Paragraph(
                    f"<b>{s['er_bg_members_label']}:</b> {member_str}", styles['ReportBody']))
        story.append(KeepTogether(bg_flowables))
        story.append(Spacer(1, 10))

    # ── Application Risk (enrichment: other apps with verdicts) ──
    app_narrative = (narrative.get('application_risk_analysis') or '').strip()
    build_section(s['er_sec_app_risk'], text_to_paras(app_narrative, styles) if app_narrative else [],
                  styles, width, story)

    if not apps.get('available'):
        story.append(Paragraph(s['er_apps_unavailable'], styles['ReportBody']))
        story.append(Spacer(1, 10))
    else:
        others = apps.get('others') or []
        if others:
            header_row = [
                Paragraph(s['er_col_app'], styles['TableHeader']),
                Paragraph(s['er_col_publisher'], styles['TableHeader']),
                Paragraph(s['er_col_verdict'], styles['TableHeader']),
                Paragraph(s['er_col_drift'], styles['TableHeader']),
                Paragraph(s['er_col_permissions'], styles['TableHeader']),
            ]
            rows = [header_row]
            for app in others:
                rows.append([
                    Paragraph(app.get('displayName') or '—', styles['TableCell']),
                    Paragraph(app.get('publisher') or '—', styles['TableCell']),
                    Paragraph(_er_verdict(app.get('verdict')), styles['TableCell']),
                    Paragraph(_er_drift(app.get('drift_state')), styles['TableCell']),
                    Paragraph(_er_perms(app.get('permissions')), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[120, 90, 60, 50, 170])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Active Exemptions ──
    if exemptions.get('active'):
        build_section(s['exemptions_title'],
                      [Paragraph(s['exemptions_intro'].format(total=exemptions.get('active', 0)), styles['ReportBody'])],
                      styles, width, story)

        # Narrative paragraph from Sonnet (exemption_analysis) — surfaces WHY
        # these exemptions exist and whether the customer should question them.
        ex_text = narrative.get('exemption_analysis', '')
        if ex_text:
            for p in text_to_paras(ex_text, styles):
                story.append(p)

        ex_list = exemptions.get('list', [])
        if ex_list:
            header_row = [
                Paragraph(s['col_policy'], styles['TableHeader']),
                Paragraph(s['col_user'], styles['TableHeader']),
                Paragraph(s['description'], styles['TableHeader']),
                Paragraph(s['col_count'], styles['TableHeader']),
                Paragraph(s['col_expires'], styles['TableHeader']),
            ]
            rows = [header_row]
            for ex in ex_list[:15]:
                match_extra = []
                if ex.get('match_country'):
                    match_extra.append(f"country={ex['match_country']}")
                if ex.get('match_ip_cidr'):
                    match_extra.append(f"cidr={ex['match_ip_cidr']}")
                user = ex.get('match_upn', '*') + (f" ({', '.join(match_extra)})" if match_extra else '')
                rows.append([
                    Paragraph(localize_policy_name(ex.get('policy_name', ''), project_root, lang), styles['TableCell']),
                    Paragraph(user, styles['TableCell']),
                    Paragraph((ex.get('reason', '') or '')[:120], styles['TableCell']),
                    Paragraph(str(ex.get('match_count', 0)), styles['TableCell']),
                    Paragraph((ex.get('expires_at', '') or '')[:10], styles['TableCell']),
                ])
            t = Table(rows, colWidths=[110, 110, 180, 50, 60])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Activity Volume ──
    if activity.get('totalEvents'):
        intro_text = s['activity_intro'].format(total=activity.get('totalEvents', 0))
        intro_paras = [Paragraph(intro_text, styles['ReportBody']), Spacer(1, 6)]
        if has_activity_chart:
            intro_paras.append(RLImage(activity_chart_buf, width=5 * inch, height=1.8 * inch))
        build_section(s['activity_title'], intro_paras, styles, width, story)

        top_pol = activity.get('topPolicies', [])
        if top_pol:
            header_row = [
                Paragraph(s['col_policy'], styles['TableHeader']),
                Paragraph(s['col_category'], styles['TableHeader']),
                Paragraph(s['col_total'], styles['TableHeader']),
            ]
            rows = [header_row]
            for p in top_pol[:8]:
                rows.append([
                    Paragraph(localize_policy_name(p.get('policy_name', ''), project_root, lang), styles['TableCell']),
                    Paragraph(localize(p.get('category', ''), ALERT_CATEGORY_LABELS, lang), styles['TableCell']),
                    Paragraph(str(p.get('total', 0)), styles['TableCell']),
                ])
            t = Table(rows, colWidths=[260, 150, 80])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#F0F0F0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#FAFAFA')]),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 10))

    # ── Conditional Access Policies ──
    ca_analysis = data.get('caAnalysis', {}) or {}
    ca_policies_list = ca_analysis.get('policies', []) or []
    ca_cross = ca_analysis.get('cross_analysis', '') or ca_analysis.get('crossAnalysis', '')

    if ca_policies_list:
        story.append(PageBreak())
        build_section(s['ca_policies_title'],
                      [Paragraph(s['ca_policies_intro'], styles['ReportBody'])],
                      styles, width, story)
        for pol in ca_policies_list:
            pol_name = pol.get('name', 'Unnamed Policy')
            pol_summary = pol.get('summary', '')
            if pol_summary:
                story.append(Paragraph(
                    f'<b>{pol_name}</b><br/>{pol_summary}',
                    styles['ReportBody']
                ))
                story.append(Spacer(1, 8))

    if ca_cross:
        build_section(s['ca_cross_analysis'], text_to_paras(ca_cross, styles),
                      styles, width, story)

    # ── Recommendations (always last) ──
    recommendations = narrative.get('recommendations', '')
    if recommendations:
        build_section(s['recommendations'], text_to_paras(recommendations, styles),
                      styles, width, story)

    # ─── Cover page rendering ───
    def on_first_page(canvas_obj, doc):
        canvas_obj.saveState()
        w, h = letter

        if cover_image_path and os.path.exists(cover_image_path):
            canvas_obj.drawImage(cover_image_path, 0, 0, width=w, height=h,
                                 preserveAspectRatio=True, anchor='c')

        # The cover's whitest area is the upper-left. The optional MSP logo sits
        # there, and the title/details stack is left-aligned directly beneath it.
        left_x = 0.6 * inch          # left margin for the whole block
        logo_top = h * 0.70          # top edge of the logo / top of the block
        logo_max_w = 2.6 * inch
        logo_max_h = 1.15 * inch

        if msp_logo_path:
            try:
                ir = ImageReader(msp_logo_path)
                iw, ih = ir.getSize()
                scale = min(logo_max_w / iw, logo_max_h / ih)
                dw, dh = iw * scale, ih * scale
                # drawImage anchors at bottom-left, so subtract the drawn height
                # to pin the logo's TOP at logo_top. mask='auto' keeps PNG alpha.
                canvas_obj.drawImage(ir, left_x, logo_top - dh, width=dw, height=dh,
                                     mask='auto')
                cursor_y = logo_top - dh - 30  # gap below the logo
            except Exception:
                cursor_y = logo_top  # logo unreadable — start text at the top
        else:
            # No logo: nudge the block down so it doesn't float at the very top.
            cursor_y = h * 0.64

        # Report title
        canvas_obj.setFont('Helvetica-Bold', 26)
        canvas_obj.setFillColor(HexColor('#1A2A3A'))
        canvas_obj.drawString(left_x, cursor_y, s['report_title'])

        # Tenant (client) name
        cursor_y -= 26
        canvas_obj.setFont('Helvetica', 16)
        canvas_obj.setFillColor(HexColor('#2C3E50'))
        canvas_obj.drawString(left_x, cursor_y, tenant_name)

        # Reporting period
        cursor_y -= 22
        canvas_obj.setFont('Helvetica', 12)
        canvas_obj.setFillColor(HexColor('#4A5568'))
        canvas_obj.drawString(left_x, cursor_y, range_label)

        # Generated timestamp
        cursor_y -= 18
        canvas_obj.setFont('Helvetica', 10)
        canvas_obj.setFillColor(HexColor('#666666'))
        if lang == 'fr':
            date_str = f"{s['generated']} {datetime.now().strftime('%d %B %Y à %H:%M')}"
        elif lang == 'es':
            date_str = f"{s['generated']} {datetime.now().strftime('%d %B %Y, %H:%M')}"
        else:
            date_str = f"{s['generated']} {datetime.now().strftime('%B %d, %Y at %H:%M')}"
        canvas_obj.drawString(left_x, cursor_y, date_str)

        # Prepared by (MSP)
        cursor_y -= 22
        canvas_obj.setFont('Helvetica-Oblique', 10)
        canvas_obj.setFillColor(HexColor('#666666'))
        canvas_obj.drawString(left_x, cursor_y, s['cover_prepared_by'].format(msp=prepared_by))

        canvas_obj.restoreState()

    def on_later_pages(canvas_obj, doc):
        template.on_page(canvas_obj, doc)

    cover_story = [Spacer(1, 1), PageBreak()] + story

    doc.build(cover_story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
    print(f'PDF generated: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python3 generate-pdf-report.py <input.json> <output.pdf>')
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    data = load_input(input_path)
    build_pdf(data, output_path)
