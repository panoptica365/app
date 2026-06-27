#!/usr/bin/env python3
"""
Panoptica365 — Documentation Report Generator (Wave 1)

Point-in-time configuration snapshot of a tenant. No date range — always
"current state". Mirrors the Tenant Dashboard cards + every expandable
section into PDF, plus Panoptica-specific data (security settings state,
exemptions, recent change log).

No AI. Pure data formatting. Volume IS the deliverable.

Usage: python3 generate-documentation-report.py <input.json> <output.pdf>
"""

import sys
import json
import os
from datetime import datetime
from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    PageBreak, Table, TableStyle, KeepTogether,
)
from reportlab.pdfgen import canvas

import re as _re
import unicodedata as _ud

# Shared email-auth helpers — text-only here (matplotlib stays lazy inside the
# gauge, which this report doesn't use), the same module the posture + QA
# generators use so the findings→rows mapping can't drift. Ensure the script's
# own dir is importable whether run as a script or via importlib.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _report_email_auth import email_auth_label, mechanism_rows  # noqa: E402

# ─── Palette (consistent with security-posture report) ───
COLORS = {
    'primary': '#2C3E50',
    'accent': '#C9A961',
    'text': '#333333',
    'text_light': '#666666',
    'healthy': '#33CC66',
    'degraded': '#FFAA00',
    'broken': '#cc4444',
    'bg_light': '#F8F9FA',
    'bg_card': '#FFFFFF',
    'border': '#DEE2E6',
    'card_border': '#E5E7EB',
}

# ─── Localized chrome strings ───
STRINGS = {
    'en': {
        'report_title': 'Configuration Documentation',
        'cover_subtitle': 'Tenant Configuration Snapshot',
        'generated': 'Generated',
        'cover_prepared_by': 'Prepared by {msp}',
        'tenant_identity': 'Tenant Identity',
        'tenant_display_name': 'Display name',
        'tenant_azure_id': 'Azure tenant ID',
        'tenant_status': 'Status',
        'tenant_mode': 'Mode',
        'tenant_consented_at': 'Consented',
        'tenant_last_polled': 'Last polled',
        'tenant_polling_interval': 'Polling interval',
        'tenant_poll_count': 'Poll count',
        'status_enabled': 'Enabled',
        'status_disabled': 'Disabled',
        'snapshot_summary': 'Snapshot Summary',
        'snapshot_intro': 'The cards below mirror the at-a-glance information shown on the Tenant Dashboard. Each card represents the most recent value from the latest poll.',
        'toc': 'Contents',
        'sec_licensing': 'Licensing',
        'sec_users': 'Users & Administrators',
        'sec_mfa': 'Multi-Factor Authentication',
        'sec_ca': 'Conditional Access Policies',
        'sec_security_settings': 'Security Settings',
        'sec_exemptions': 'Active Alert Exemptions',
        'sec_devices': 'Devices',
        'sec_domains': 'Domains & DNS',
        'sec_sharepoint': 'SharePoint Online',
        'sec_onedrive': 'OneDrive for Business',
        'sec_exchange': 'Exchange Online',
        'sec_inbox_rules': 'Inbox Rules',
        'sec_teams': 'Microsoft Teams',
        'sec_apps': 'Applications',
        'sec_alert_policies': 'Alert Policies',
        'sec_recent_changes': 'Recent Configuration Changes (last 90 days)',
        'no_data': 'No data available — this category was not captured in the latest poll.',
        'previous_snapshot_note': 'A previous snapshot exists from {date}. Diff rendering will land in a future release.',
        'card_secure_score': 'Secure Score',
        'card_users_total': 'Total Users',
        'card_users_licensed': 'Licensed',
        'card_users_unlicensed': 'Unlicensed',
        'card_global_admins': 'Global Admins',
        'card_ca_policies': 'CA Policies',
        'card_ca_enabled': 'enabled',
        'card_security_defaults': 'Security Defaults',
        'card_mfa': 'MFA Registered',
        'card_devices': 'Devices',
        'card_devices_managed': 'Managed',
        'card_sp_sites': 'SharePoint Sites',
        'card_anon_links': 'Anonymous Links',
        'card_onedrive': 'OneDrive Accounts',
        'card_mailboxes': 'Mailboxes',
        'card_teams': 'Teams',
        'card_inbox_rules': 'Inbox Rules',
        'card_risky_users': 'Risky Users',
        'card_inactive_users': 'Inactive 90d',
        'card_stale_devices': 'Stale Devices',
        'card_apps_registered': 'Registered Apps',
        'card_apps_enterprise': 'Enterprise Apps',
        'card_domains': 'Domains',
        'col_name': 'Name', 'col_upn': 'UPN', 'col_email': 'Email',
        'col_status': 'Status', 'col_assigned': 'Assigned', 'col_total': 'Total',
        'col_available': 'Available', 'col_priority': 'Priority',
        'col_setting': 'Setting', 'col_category': 'Category',
        'col_state': 'State', 'col_conditions': 'Conditions',
        'col_controls': 'Controls', 'col_policy': 'Policy',
        'col_last_matched': 'Last matched', 'col_match_count': 'Matches',
        'col_expires': 'Expires', 'col_when': 'When', 'col_who': 'Who',
        'col_description': 'Description', 'col_source': 'Source',
        'col_severity': 'Severity', 'col_enabled': 'Enabled',
        'col_match_criteria': 'Match',
        'col_value': 'Value',
        'col_last_signin': 'Last sign-in',
        'col_never': 'Never',
        'col_lic_short': 'Lic',
        'col_app_id': 'App ID',
        'col_audience': 'Audience',
        'col_created': 'Created',
        'col_visibility': 'Visibility',
        'col_compliance': 'Compliance',
        'col_device': 'Device',
        'col_os': 'OS',
        'col_user': 'User',
        'col_last_sync': 'Last sync',
        'col_type': 'Type',
        'col_service': 'Service',
        'col_expected': 'Expected',
        'col_flags': 'Flags',
        'col_auth_type': 'Auth type',
        'col_site': 'Site',
        'col_files': 'Files',
        'col_storage': 'Storage',
        'col_views': 'Views',
        'col_last_active': 'Last active',
        'col_items': 'Items',
        'col_date': 'Date',
        'col_sent': 'Sent',
        'col_received': 'Received',
        'col_read': 'Read',
        'col_count': 'Count',
        'col_anonymous': 'Anonymous',
        'col_company': 'Company',
        'col_rule': 'Rule',
        'col_target': 'Target',
        'inbox_rule_external': 'External',
        'inbox_rule_internal': 'Internal',
        'sub_inactive_internal': 'Inactive internal users ({n})',
        'sub_inactive_guests': 'Inactive guest accounts ({n})',
        'sub_stale_devices': 'Stale devices ({n})',
        'sub_risky_users': 'Risky users ({n})',
        'col_last_activity': 'Last activity',
        'col_trust_type': 'Trust type',
        'col_risk_level': 'Risk level',
        'col_risk_state': 'Risk state',
        'col_licensed': 'Licensed',
        'sub_devices_by_os': 'By Operating System',
        'sub_intune_devices': 'Intune-managed Devices ({count})',
        'sub_top_mailboxes': 'Top Mailboxes by Storage',
        'sub_mail_activity': 'Mail Activity (recent days)',
        'sub_anon_links': 'Anonymous Sharing Links',
        'sub_dns_for': 'DNS — {domain}',
        'sub_forwarding_rules': 'Forwarding Rules ({count})',
        'sub_all_inbox_rules': 'All Inbox Rules ({count})',
        'inbox_rules_summary_note': 'Detail intentionally summarized — see Tenant Dashboard → Inbox Rules for the full action breakdown per rule.',
        'mfa_intro': 'Of <b>{total}</b> users, <b>{pct}%</b> are registered for MFA. <b>{missing}</b> users have not yet registered.',
        'more_rows': '+ {count} more',
        'card_subtitle_missing': 'missing: {n}',
        'card_subtitle_compliant': 'compliant: {n} / {total}',
        'card_subtitle_managed': '{n} / {total}',
        'card_subtitle_teams': 'public: {pub} · private: {pri}',
        'card_subtitle_files': '{gb} GB · {files} files',
        'card_subtitle_inactive': 'int: {int_n} · ext: {ext_n}',
        'card_subtitle_risky': 'high: {high} · medium: {medium}',
        'card_subtitle_anon_sites': 'sites: {n}',
        'card_subtitle_storage_gb': '{gb} GB',
        'inactive_signin_note_pdf': 'Sign-in detection requires Microsoft Entra ID P1 (included with Microsoft 365 Business Premium). Users on plans without P1 cannot be evaluated for sign-in activity.',
        'inactive_signin_unavailable_note_pdf': '{count} additional user(s) could not be evaluated (no Entra ID P1 license).',
        'sub_inactive_unavailable_internal': 'Inactive internal users — not evaluable',
        'sub_inactive_unavailable_guests': 'Inactive guest accounts — not evaluable',
        'footer_report': 'Configuration Documentation',
        'footer_page': 'Page',
        'footer_generated': 'Generated',
        'footer_confidential_with_platform': 'Confidential — Prepared by {msp} via Panoptica365 for authorized recipients only',
        'footer_confidential_no_platform': 'Confidential — Prepared by {msp} for authorized recipients only',
        'pri_critical': 'Critical', 'pri_high': 'High', 'pri_medium': 'Medium', 'pri_low': 'Low',
        'set_status_monitored': 'Matched',
        'set_status_drift': 'Drift',
        'set_status_not_applied': 'Not applied',
        'set_status_pending': 'Pending',
        'set_status_poll_error': 'Poll error',
        'set_status_unavailable': 'Unavailable',
        # ─── Enrichment (Identity Hygiene + Application Governance) ───
        'er_sec_identity': 'Identity Hygiene',
        'er_sec_admins': 'Accounts with Admin Roles',
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
        'er_col_app': 'Application',
        'er_col_publisher': 'Publisher',
        'er_col_verdict': 'Risk Verdict',
        'er_col_permissions': 'Permissions',
        'er_col_drift': 'Drift',
        'er_yes': 'Yes',
        'er_no': 'No',
        'er_unknown': 'Unknown',
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
        'er_all_known_good': 'All applications are tagged Known-Good.',
        'er_identity_unavailable': 'Access Review data has not been captured for this tenant. Run an Access Review to populate identity hygiene.',
        # ─── Report polish v0.2.24 — Email Authentication (shared verbatim) ───
        'email_auth_title': 'Email Authentication',
        'email_auth_intro': "DNS email-authentication posture for this tenant's primary sending domain.",
        'email_auth_unavailable': 'Email authentication has not been audited for this tenant. Run a Refresh on the Email Auth tab to populate it.',
        'ea_col_mechanism': 'Mechanism',
        'ea_col_status': 'Status',
        'ea_col_detail': 'Detail',
        'email_auth_other_domains': 'Other mail domains',
        'email_auth_nonmail_note': 'Non-mail domains should publish v=spf1 -all and DMARC p=reject to prevent spoofing: {domains}',
        'er_apps_unavailable': 'Application inventory is not available. Run the Applications scan.',
        'er_bg_not_configured': 'No break-glass (emergency-access) group is configured for this tenant.',
        'er_bg_members_unavailable': 'Group membership could not be read at report time.',
    },
    'fr': {
        'report_title': 'Rapport de configuration',
        'cover_subtitle': '',
        'generated': 'Généré le',
        'cover_prepared_by': 'Préparé par {msp}',
        'tenant_identity': 'Identité du locataire',
        'tenant_display_name': 'Nom d\'affichage',
        'tenant_azure_id': 'ID Azure du locataire',
        'tenant_status': 'Statut',
        'tenant_mode': 'Mode',
        'tenant_consented_at': 'Consentement',
        'tenant_last_polled': 'Dernière scrutation',
        'tenant_polling_interval': 'Intervalle de scrutation',
        'tenant_poll_count': 'Nombre de scrutations',
        'status_enabled': 'Activé',
        'status_disabled': 'Désactivé',
        'snapshot_summary': 'Résumé',
        'snapshot_intro': 'Les cartes ci-dessous reflètent les informations en un coup d\'œil présentées sur le tableau de bord du locataire. Chaque carte affiche la valeur la plus récente issue de la dernière scrutation.',
        'toc': 'Table des matières',
        'sec_licensing': 'Licences',
        'sec_users': 'Utilisateurs et administrateurs',
        'sec_mfa': 'Authentification multifactorielle',
        'sec_ca': 'Politiques d\'accès conditionnel',
        'sec_security_settings': 'Paramètres de sécurité',
        'sec_exemptions': 'Exemptions d\'alertes actives',
        'sec_devices': 'Appareils',
        'sec_domains': 'Domaines et DNS',
        'sec_sharepoint': 'SharePoint Online',
        'sec_onedrive': 'OneDrive Entreprise',
        'sec_exchange': 'Exchange Online',
        'sec_inbox_rules': 'Règles de boîte de réception',
        'sec_teams': 'Microsoft Teams',
        'sec_apps': 'Applications',
        'sec_alert_policies': 'Politiques d\'alertes',
        'sec_recent_changes': 'Changements de configuration récents (90 derniers jours)',
        'no_data': 'Aucune donnée disponible — cette catégorie n\'a pas été capturée lors de la dernière scrutation.',
        'previous_snapshot_note': 'Une version précédente de ce rapport existe depuis le {date}. Le rendu différentiel sera ajouté dans une prochaine version.',
        'card_secure_score': 'Score de sécurité',
        'card_users_total': 'Utilisateurs',
        'card_users_licensed': 'Licenciés',
        'card_users_unlicensed': 'Non licenciés',
        'card_global_admins': 'Admins globaux',
        'card_ca_policies': 'Politiques CA',
        'card_ca_enabled': 'activées',
        'card_security_defaults': 'Sécurité par défaut',
        'card_mfa': 'AMF enrôlés',
        'card_devices': 'Appareils',
        'card_devices_managed': 'Gérés',
        'card_sp_sites': 'Sites SharePoint',
        'card_anon_links': 'Liens anonymes',
        'card_onedrive': 'Comptes OneDrive',
        'card_mailboxes': 'Boîtes courriel',
        'card_teams': 'Équipes',
        'card_inbox_rules': 'Règles boîte rcpt',
        'card_risky_users': 'Utilisateurs à risque',
        'card_inactive_users': 'Inactifs 90j',
        'card_stale_devices': 'Appareils obsolètes',
        'card_apps_registered': 'Applis enregistrées',
        'card_apps_enterprise': 'Applis entreprise',
        'card_domains': 'Domaines',
        'col_name': 'Nom', 'col_upn': 'UPN', 'col_email': 'Courriel',
        'col_status': 'Statut', 'col_assigned': 'Assignés', 'col_total': 'Total',
        'col_available': 'Disponibles', 'col_priority': 'Priorité',
        'col_setting': 'Paramètre', 'col_category': 'Catégorie',
        'col_state': 'État', 'col_conditions': 'Conditions',
        'col_controls': 'Contrôles', 'col_policy': 'Politique',
        'col_last_matched': 'Dernier match', 'col_match_count': 'Matches',
        'col_expires': 'Expire', 'col_when': 'Quand', 'col_who': 'Qui',
        'col_description': 'Description', 'col_source': 'Source',
        'col_severity': 'Sévérité', 'col_enabled': 'Activé',
        'col_match_criteria': 'Critère',
        'col_value': 'Valeur',
        'col_last_signin': 'Dernière connexion',
        'col_never': 'Jamais',
        'col_lic_short': 'Lic',
        'col_app_id': 'ID app',
        'col_audience': 'Public',
        'col_created': 'Créé',
        'col_visibility': 'Visibilité',
        'col_compliance': 'Conformité',
        'col_device': 'Appareil',
        'col_os': 'OS',
        'col_user': 'Utilisateur',
        'col_last_sync': 'Dernière sync',
        'col_type': 'Type',
        'col_service': 'Service',
        'col_expected': 'Attendu',
        'col_flags': 'Indicateurs',
        'col_auth_type': 'Authentification',
        'col_site': 'Site',
        'col_files': 'Fichiers',
        'col_storage': 'Stockage',
        'col_views': 'Vues',
        'col_last_active': 'Dernière activité',
        'col_items': 'Éléments',
        'col_date': 'Date',
        'col_sent': 'Envoyés',
        'col_received': 'Reçus',
        'col_read': 'Lus',
        'col_count': 'Nombre',
        'col_anonymous': 'Anonymes',
        'col_company': 'Entreprise',
        'col_rule': 'Règle',
        'col_target': 'Destinataire',
        'inbox_rule_external': 'Externe',
        'inbox_rule_internal': 'Interne',
        'sub_inactive_internal': 'Utilisateurs internes inactifs ({n})',
        'sub_inactive_guests': 'Comptes invités inactifs ({n})',
        'sub_stale_devices': 'Appareils obsolètes ({n})',
        'sub_risky_users': 'Utilisateurs à risque ({n})',
        'col_last_activity': 'Dernière activité',
        'col_trust_type': 'Type d\'appartenance',
        'col_risk_level': 'Niveau de risque',
        'col_risk_state': 'État du risque',
        'col_licensed': 'Licencié',
        'sub_devices_by_os': 'Par système d\'exploitation',
        'sub_intune_devices': 'Appareils gérés par Intune ({count})',
        'sub_top_mailboxes': 'Boîtes courriel les plus volumineuses',
        'sub_mail_activity': 'Activité courriel (jours récents)',
        'sub_anon_links': 'Liens de partage anonymes',
        'sub_dns_for': 'DNS — {domain}',
        'sub_forwarding_rules': 'Règles de transfert ({count})',
        'sub_all_inbox_rules': 'Toutes les règles de boîte de réception ({count})',
        'inbox_rules_summary_note': 'Détail volontairement résumé — voir Tableau de bord du locataire → Règles de boîte de réception pour la ventilation complète des actions par règle.',
        'mfa_intro': 'Sur <b>{total}</b> utilisateurs, <b>{pct} %</b> sont enregistrés pour l\'AMF. <b>{missing}</b> utilisateurs ne sont pas encore enregistrés.',
        'more_rows': '+ {count} de plus',
        'card_subtitle_missing': 'manquants : {n}',
        'card_subtitle_compliant': 'conformes : {n} / {total}',
        'card_subtitle_managed': '{n} / {total}',
        'card_subtitle_teams': 'publiques : {pub} · privées : {pri}',
        'card_subtitle_files': '{gb} Go · {files} fichiers',
        'card_subtitle_inactive': 'int : {int_n} · ext : {ext_n}',
        'card_subtitle_risky': 'élevé : {high} · moyen : {medium}',
        'card_subtitle_anon_sites': 'sites : {n}',
        'card_subtitle_storage_gb': '{gb} Go',
        'inactive_signin_note_pdf': "La détection de la connexion nécessite Microsoft Entra ID P1 (inclus avec Microsoft 365 Business Premium). Les utilisateurs sur des forfaits sans P1 ne peuvent pas être évalués.",
        'inactive_signin_unavailable_note_pdf': "{count} utilisateur(s) supplémentaire(s) n'a/ont pas pu être évalué(s) (pas de licence Entra ID P1).",
        'sub_inactive_unavailable_internal': 'Utilisateurs internes inactifs — non évaluables',
        'sub_inactive_unavailable_guests': 'Comptes invités inactifs — non évaluables',
        'footer_report': 'Rapport de configuration',
        'footer_page': 'Page',
        'footer_generated': 'Généré le',
        'footer_confidential_with_platform': 'Confidentiel — Préparé par {msp} via Panoptica365 pour les destinataires autorisés uniquement',
        'footer_confidential_no_platform': 'Confidentiel — Préparé par {msp} pour les destinataires autorisés uniquement',
        'pri_critical': 'Critique', 'pri_high': 'Élevée', 'pri_medium': 'Moyenne', 'pri_low': 'Faible',
        'set_status_monitored': 'Conforme',
        'set_status_drift': 'Dérive',
        'set_status_not_applied': 'Non appliqué',
        'set_status_pending': 'En attente',
        'set_status_poll_error': 'Erreur de scrutation',
        'set_status_unavailable': 'Indisponible',
        # ─── Enrichment (Identity Hygiene + Application Governance) ───
        'er_sec_identity': 'Hygiène des identités',
        'er_sec_admins': 'Comptes avec rôles d\'administration',
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
        'er_col_app': 'Application',
        'er_col_publisher': 'Éditeur',
        'er_col_verdict': 'Verdict de risque',
        'er_col_permissions': 'Autorisations',
        'er_col_drift': 'Dérive',
        'er_yes': 'Oui',
        'er_no': 'Non',
        'er_unknown': 'Inconnu',
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
        'er_all_known_good': 'Toutes les applications sont approuvées.',
        'er_identity_unavailable': 'Les données de revue des accès n\'ont pas été recueillies pour ce locataire. Lancez une revue des accès pour renseigner l\'hygiène des identités.',
        # ─── Report polish v0.2.24 — Authentification du courriel (partagé) ───
        'email_auth_title': 'Authentification du courriel',
        'email_auth_intro': "Posture d'authentification des courriels (DNS) pour le domaine d'envoi principal de ce locataire.",
        'email_auth_unavailable': "L'authentification des courriels n'a pas été vérifiée pour ce locataire. Lancez une actualisation dans l'onglet Authentification du courriel pour la renseigner.",
        'ea_col_mechanism': 'Mécanisme',
        'ea_col_status': 'Statut',
        'ea_col_detail': 'Détail',
        'email_auth_other_domains': 'Autres domaines de courriel',
        'email_auth_nonmail_note': "Les domaines sans courriel devraient publier v=spf1 -all et DMARC p=reject pour empêcher l'usurpation : {domains}",
        'er_apps_unavailable': 'L\'inventaire des applications n\'est pas disponible. Lancez l\'analyse des applications.',
        'er_bg_not_configured': 'Aucun groupe de compte d\'urgence (bris de glace) n\'est configuré pour ce locataire.',
        'er_bg_members_unavailable': 'L\'appartenance au groupe n\'a pas pu être lue au moment du rapport.',
    },
    'es': {
        'report_title': 'Documentación de Configuración',
        'cover_subtitle': 'Instantánea de configuración del inquilino',
        'generated': 'Generado',
        'cover_prepared_by': 'Preparado por {msp}',
        'tenant_identity': 'Identidad del inquilino',
        'tenant_display_name': 'Nombre',
        'tenant_azure_id': 'ID Azure del inquilino',
        'tenant_status': 'Estado',
        'tenant_mode': 'Modo',
        'tenant_consented_at': 'Consentimiento',
        'tenant_last_polled': 'Último sondeo',
        'tenant_polling_interval': 'Intervalo de sondeo',
        'tenant_poll_count': 'Recuento de sondeos',
        'status_enabled': 'Habilitado',
        'status_disabled': 'Deshabilitado',
        'snapshot_summary': 'Resumen Instantáneo',
        'snapshot_intro': 'Las tarjetas a continuación reflejan la información de un vistazo del Panel del Inquilino. Cada tarjeta muestra el valor más reciente del último sondeo.',
        'toc': 'Índice',
        'sec_licensing': 'Licencias',
        'sec_users': 'Usuarios y Administradores',
        'sec_mfa': 'Autenticación Multifactor',
        'sec_ca': 'Políticas de Acceso Condicional',
        'sec_security_settings': 'Configuración de Seguridad',
        'sec_exemptions': 'Exenciones de Alertas Activas',
        'sec_devices': 'Dispositivos',
        'sec_domains': 'Dominios y DNS',
        'sec_sharepoint': 'SharePoint Online',
        'sec_onedrive': 'OneDrive para la Empresa',
        'sec_exchange': 'Exchange Online',
        'sec_inbox_rules': 'Reglas de Bandeja',
        'sec_teams': 'Microsoft Teams',
        'sec_apps': 'Aplicaciones',
        'sec_alert_policies': 'Políticas de Alertas',
        'sec_recent_changes': 'Cambios de Configuración Recientes (últimos 90 días)',
        'no_data': 'No hay datos disponibles — esta categoría no se capturó en el último sondeo.',
        'previous_snapshot_note': 'Existe una instantánea previa del {date}. La representación de diferencias llegará en una versión futura.',
        'card_secure_score': 'Puntuación de seguridad',
        'card_users_total': 'Usuarios totales',
        'card_users_licensed': 'Con licencia',
        'card_users_unlicensed': 'Sin licencia',
        'card_global_admins': 'Admins globales',
        'card_ca_policies': 'Políticas CA',
        'card_ca_enabled': 'habilitadas',
        'card_security_defaults': 'Valores predet. seguridad',
        'card_mfa': 'MFA registrados',
        'card_devices': 'Dispositivos',
        'card_devices_managed': 'Administrados',
        'card_sp_sites': 'Sitios SharePoint',
        'card_anon_links': 'Enlaces anónimos',
        'card_onedrive': 'Cuentas OneDrive',
        'card_mailboxes': 'Buzones',
        'card_teams': 'Equipos',
        'card_inbox_rules': 'Reglas bandeja',
        'card_risky_users': 'Usuarios de riesgo',
        'card_inactive_users': 'Inactivos 90d',
        'card_stale_devices': 'Dispositivos obsoletos',
        'card_apps_registered': 'Apps registradas',
        'card_apps_enterprise': 'Apps empresariales',
        'card_domains': 'Dominios',
        'col_name': 'Nombre', 'col_upn': 'UPN', 'col_email': 'Correo',
        'col_status': 'Estado', 'col_assigned': 'Asignadas', 'col_total': 'Total',
        'col_available': 'Disponibles', 'col_priority': 'Prioridad',
        'col_setting': 'Configuración', 'col_category': 'Categoría',
        'col_state': 'Estado', 'col_conditions': 'Condiciones',
        'col_controls': 'Controles', 'col_policy': 'Política',
        'col_last_matched': 'Último match', 'col_match_count': 'Coincid.',
        'col_expires': 'Expira', 'col_when': 'Cuándo', 'col_who': 'Quién',
        'col_description': 'Descripción', 'col_source': 'Origen',
        'col_severity': 'Severidad', 'col_enabled': 'Habilitada',
        'col_match_criteria': 'Coincidencia',
        'col_value': 'Valor',
        'col_last_signin': 'Último inicio de sesión',
        'col_never': 'Nunca',
        'col_lic_short': 'Lic',
        'col_app_id': 'ID app',
        'col_audience': 'Audiencia',
        'col_created': 'Creado',
        'col_visibility': 'Visibilidad',
        'col_compliance': 'Cumplimiento',
        'col_device': 'Dispositivo',
        'col_os': 'SO',
        'col_user': 'Usuario',
        'col_last_sync': 'Última sinc.',
        'col_type': 'Tipo',
        'col_service': 'Servicio',
        'col_expected': 'Esperado',
        'col_flags': 'Indicadores',
        'col_auth_type': 'Autenticación',
        'col_site': 'Sitio',
        'col_files': 'Archivos',
        'col_storage': 'Almacenamiento',
        'col_views': 'Vistas',
        'col_last_active': 'Última actividad',
        'col_items': 'Elementos',
        'col_date': 'Fecha',
        'col_sent': 'Enviados',
        'col_received': 'Recibidos',
        'col_read': 'Leídos',
        'col_count': 'Recuento',
        'col_anonymous': 'Anónimos',
        'col_company': 'Empresa',
        'col_rule': 'Regla',
        'col_target': 'Destinatario',
        'inbox_rule_external': 'Externa',
        'inbox_rule_internal': 'Interna',
        'sub_inactive_internal': 'Usuarios internos inactivos ({n})',
        'sub_inactive_guests': 'Cuentas de invitados inactivas ({n})',
        'sub_stale_devices': 'Dispositivos obsoletos ({n})',
        'sub_risky_users': 'Usuarios de riesgo ({n})',
        'col_last_activity': 'Última actividad',
        'col_trust_type': 'Tipo de pertenencia',
        'col_risk_level': 'Nivel de riesgo',
        'col_risk_state': 'Estado del riesgo',
        'col_licensed': 'Con licencia',
        'sub_devices_by_os': 'Por sistema operativo',
        'sub_intune_devices': 'Dispositivos gestionados por Intune ({count})',
        'sub_top_mailboxes': 'Buzones más grandes por almacenamiento',
        'sub_mail_activity': 'Actividad de correo (días recientes)',
        'sub_anon_links': 'Enlaces de compartición anónimos',
        'sub_dns_for': 'DNS — {domain}',
        'sub_forwarding_rules': 'Reglas de reenvío ({count})',
        'sub_all_inbox_rules': 'Todas las reglas de bandeja de entrada ({count})',
        'inbox_rules_summary_note': 'Detalle resumido intencionalmente — vea Panel del Inquilino → Reglas de Bandeja para el desglose completo de acciones por regla.',
        'mfa_intro': 'De <b>{total}</b> usuarios, el <b>{pct}%</b> están registrados para MFA. <b>{missing}</b> usuarios aún no se han registrado.',
        'more_rows': '+ {count} más',
        'card_subtitle_missing': 'faltan: {n}',
        'card_subtitle_compliant': 'conformes: {n} / {total}',
        'card_subtitle_managed': '{n} / {total}',
        'card_subtitle_teams': 'públicos: {pub} · privados: {pri}',
        'card_subtitle_files': '{gb} GB · {files} archivos',
        'card_subtitle_inactive': 'int: {int_n} · ext: {ext_n}',
        'card_subtitle_risky': 'alto: {high} · medio: {medium}',
        'card_subtitle_anon_sites': 'sitios: {n}',
        'card_subtitle_storage_gb': '{gb} GB',
        'inactive_signin_note_pdf': 'La detección de inicio de sesión requiere Microsoft Entra ID P1 (incluido en Microsoft 365 Business Premium). Los usuarios en planes sin P1 no pueden ser evaluados.',
        'inactive_signin_unavailable_note_pdf': 'No se pudo evaluar a {count} usuario(s) adicional(es) (sin licencia Entra ID P1).',
        'sub_inactive_unavailable_internal': 'Usuarios internos inactivos — no evaluables',
        'sub_inactive_unavailable_guests': 'Cuentas de invitados inactivas — no evaluables',
        'footer_report': 'Documentación de Configuración',
        'footer_page': 'Página',
        'footer_generated': 'Generado',
        'footer_confidential_with_platform': 'Confidencial — Preparado por {msp} mediante Panoptica365 únicamente para destinatarios autorizados',
        'footer_confidential_no_platform': 'Confidencial — Preparado por {msp} únicamente para destinatarios autorizados',
        'pri_critical': 'Crítica', 'pri_high': 'Alta', 'pri_medium': 'Media', 'pri_low': 'Baja',
        'set_status_monitored': 'Coincide',
        'set_status_drift': 'Desviación',
        'set_status_not_applied': 'No aplicada',
        'set_status_pending': 'Pendiente',
        'set_status_poll_error': 'Error de sondeo',
        'set_status_unavailable': 'No disponible',
        # ─── Enrichment (Identity Hygiene + Application Governance) ───
        'er_sec_identity': 'Higiene de identidades',
        'er_sec_admins': 'Cuentas con roles de administrador',
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
        'er_col_app': 'Aplicación',
        'er_col_publisher': 'Editor',
        'er_col_verdict': 'Veredicto de riesgo',
        'er_col_permissions': 'Permisos',
        'er_col_drift': 'Desviación',
        'er_yes': 'Sí',
        'er_no': 'No',
        'er_unknown': 'Desconocido',
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
        'er_all_known_good': 'Todas las aplicaciones están aprobadas.',
        'er_identity_unavailable': 'No se han recopilado datos de revisión de acceso para este inquilino. Ejecute una revisión de acceso para completar la higiene de identidades.',
        # ─── Report polish v0.2.24 — Autenticación de correo (compartido) ───
        'email_auth_title': 'Autenticación de correo',
        'email_auth_intro': 'Postura de autenticación de correo (DNS) del dominio de envío principal de este inquilino.',
        'email_auth_unavailable': 'La autenticación de correo no se ha auditado para este inquilino. Ejecute Actualizar en la pestaña Autenticación de correo para completarla.',
        'ea_col_mechanism': 'Mecanismo',
        'ea_col_status': 'Estado',
        'ea_col_detail': 'Detalle',
        'email_auth_other_domains': 'Otros dominios de correo',
        'email_auth_nonmail_note': 'Los dominios sin correo deberían publicar v=spf1 -all y DMARC p=reject para evitar la suplantación: {domains}',
        'er_apps_unavailable': 'El inventario de aplicaciones no está disponible. Ejecute el análisis de aplicaciones.',
        'er_bg_not_configured': 'No hay configurado ningún grupo de acceso de emergencia (break-glass) para este inquilino.',
        'er_bg_members_unavailable': 'No se pudo leer la pertenencia al grupo al momento del informe.',
    },
}

SETTING_STATUS_LABELS = {
    'monitored': 'set_status_monitored',
    'drift': 'set_status_drift',
    'not_applied': 'set_status_not_applied',
    'pending': 'set_status_pending',
    'poll_error': 'set_status_poll_error',
    'unavailable': 'set_status_unavailable',
}

# ─── Enum-value localization tables ────────────────────────────────────
# DB columns store English; render in tenant language. Same pattern used in
# the security-posture report (src/lib/event-description-i18n.js mirror).

# License status (from Microsoft Graph subscribedSkus)
LICENSE_STATUS_LABELS = {
    'en': {'Enabled': 'Enabled', 'Suspended': 'Suspended', 'Warning': 'Warning',
           'LockedOut': 'Locked Out', 'Deleted': 'Deleted'},
    'fr': {'Enabled': 'Actif', 'Suspended': 'Suspendu', 'Warning': 'Avertissement',
           'LockedOut': 'Verrouillé', 'Deleted': 'Supprimé'},
    'es': {'Enabled': 'Habilitada', 'Suspended': 'Suspendida', 'Warning': 'Aviso',
           'LockedOut': 'Bloqueada', 'Deleted': 'Eliminada'},
}

# Tenant mode (tenants.mode ENUM)
TENANT_MODE_LABELS = {
    'en': {'managed': 'Managed', 'audit_only': 'Audit Only'},
    'fr': {'managed': 'Géré', 'audit_only': 'Audit seulement'},
    'es': {'managed': 'Gestionado', 'audit_only': 'Solo auditoría'},
}

# Conditional Access policy state (Microsoft Graph)
CA_STATE_LABELS = {
    'en': {'enabled': 'Enabled', 'disabled': 'Disabled',
           'enabledForReportingButNotEnforced': 'Report-only'},
    'fr': {'enabled': 'Activée', 'disabled': 'Désactivée',
           'enabledForReportingButNotEnforced': 'Rapport seulement'},
    'es': {'enabled': 'Habilitada', 'disabled': 'Deshabilitada',
           'enabledForReportingButNotEnforced': 'Solo informe'},
}

# Security setting category (security_settings.category ENUM)
SETTING_CATEGORY_LABELS = {
    'en': {'exchange': 'Exchange', 'identity': 'Identity', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Compliance'},
    'fr': {'exchange': 'Exchange', 'identity': 'Identité', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Conformité'},
    'es': {'exchange': 'Exchange', 'identity': 'Identidad', 'sharepoint': 'SharePoint',
           'teams': 'Teams', 'defender': 'Defender', 'compliance': 'Cumplimiento'},
}

# Security setting priority
SETTING_PRIORITY_LABELS = {
    'en': {'critical': 'Critical', 'high': 'High', 'medium': 'Medium', 'low': 'Low'},
    'fr': {'critical': 'Critique', 'high': 'Élevée', 'medium': 'Moyenne', 'low': 'Faible'},
    'es': {'critical': 'Crítica', 'high': 'Alta', 'medium': 'Media', 'low': 'Baja'},
}

# Alert policy categories (alert_policies.category ENUM, 6 strict values)
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

# Alert severity (alert_policies.severity ENUM)
ALERT_SEVERITY_LABELS = {
    'en': {'severe': 'Critical', 'high': 'High', 'medium': 'Medium', 'low': 'Low', 'info': 'Info'},
    'fr': {'severe': 'Critique', 'high': 'Élevée', 'medium': 'Moyenne', 'low': 'Faible', 'info': 'Info'},
    'es': {'severe': 'Crítico', 'high': 'Alto', 'medium': 'Medio', 'low': 'Bajo', 'info': 'Info'},
}

# Generic enabled/disabled toggle
ENABLED_TOGGLE_LABELS = {
    'en': {True: 'ON', False: 'OFF'},
    'fr': {True: 'Activé', False: 'Désactivé'},
    'es': {True: 'Activado', False: 'Desactivado'},
}

# DNS record status (Microsoft Graph domains.dnsRecordStatus.status)
DNS_STATUS_LABELS = {
    'en': {'OK': 'OK', 'Missing': 'Missing', 'Mismatch': 'Mismatch', 'Unknown': 'Unknown'},
    'fr': {'OK': 'OK', 'Missing': 'Absent', 'Mismatch': 'Incohérent', 'Unknown': 'Inconnu'},
    'es': {'OK': 'OK', 'Missing': 'Falta', 'Mismatch': 'Incoherente', 'Unknown': 'Desconocido'},
}

# Domain flags (Graph domain.isDefault / isVerified)
DOMAIN_FLAG_LABELS = {
    'en': {'default': 'default', 'verified': 'verified', 'admin_managed': 'admin-managed',
           'initial': 'initial'},
    'fr': {'default': 'par défaut', 'verified': 'vérifié', 'admin_managed': 'géré par admin',
           'initial': 'initial'},
    'es': {'default': 'predeterminado', 'verified': 'verificado',
           'admin_managed': 'gestionado por admin', 'initial': 'inicial'},
}

# Microsoft 365 device authentication type
DOMAIN_AUTH_TYPE_LABELS = {
    'en': {'Managed': 'Managed', 'Federated': 'Federated'},
    'fr': {'Managed': 'Géré', 'Federated': 'Fédéré'},
    'es': {'Managed': 'Gestionado', 'Federated': 'Federado'},
}

# Teams visibility
TEAMS_VISIBILITY_LABELS = {
    'en': {'Public': 'Public', 'Private': 'Private', 'HiddenMembership': 'Hidden Membership'},
    'fr': {'Public': 'Publique', 'Private': 'Privée', 'HiddenMembership': 'Membres masqués'},
    'es': {'Public': 'Pública', 'Private': 'Privada', 'HiddenMembership': 'Miembros ocultos'},
}

# Intune compliance state
COMPLIANCE_STATE_LABELS = {
    'en': {'compliant': 'Compliant', 'noncompliant': 'Non-compliant',
           'inGracePeriod': 'In grace period', 'unknown': 'Unknown',
           'conflict': 'Conflict', 'error': 'Error'},
    'fr': {'compliant': 'Conforme', 'noncompliant': 'Non conforme',
           'inGracePeriod': 'Période de grâce', 'unknown': 'Inconnu',
           'conflict': 'Conflit', 'error': 'Erreur'},
    'es': {'compliant': 'Conforme', 'noncompliant': 'No conforme',
           'inGracePeriod': 'Período de gracia', 'unknown': 'Desconocido',
           'conflict': 'Conflicto', 'error': 'Error'},
}


def localize_enum(value, lookup_map, lang):
    """Look up a localized string for a DB enum value. Falls back to original."""
    if value is None:
        return ''
    return lookup_map.get(lang, lookup_map.get('en', {})).get(value, value)

SETTING_STATUS_COLORS = {
    'monitored': COLORS['healthy'],
    'drift': COLORS['broken'],
    'not_applied': COLORS['text_light'],
    'pending': COLORS['degraded'],
    'poll_error': COLORS['broken'],
    'unavailable': '#bbbbbb',
}


# ─── Markdown → HTML (so Sonnet-style **bold** works in legacy text fields) ───
_MD_BOLD = _re.compile(r'\*\*(.+?)\*\*', flags=_re.DOTALL)
_MD_ITALIC_AST = _re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', flags=_re.DOTALL)


def md_to_html(text):
    if not text:
        return text or ''
    out = _MD_BOLD.sub(r'<b>\1</b>', str(text))
    out = _MD_ITALIC_AST.sub(r'<i>\1</i>', out)
    return out


def get_strings(lang):
    return STRINGS.get(lang, STRINGS['en'])


def esc(s):
    """Escape for ReportLab Paragraph (it uses XML-like markup)."""
    if s is None:
        return ''
    return (str(s)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;'))


def fmt_num(n):
    if n is None:
        return '—'
    try:
        return f'{int(n):,}'
    except (ValueError, TypeError):
        return str(n)


def fmt_pct(p, decimals=1):
    if p is None:
        return '—'
    try:
        return f'{float(p):.{decimals}f}'
    except (ValueError, TypeError):
        return str(p)


# ─── Locale-file backed alert policy name lookup ───
# alert_policies.name is stored in English. Localized names live under
# alert_policy_names.<slug>. Same convention as the operator UI.
_LOCALE_CACHE = {}


def _load_locale(project_root, lang):
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
    if not s:
        return ''
    s = ''.join(c for c in _ud.normalize('NFKD', str(s).lower()) if not _ud.combining(c))
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
    if not name or lang == 'en':
        return name or ''
    locale = _load_locale(project_root, lang)
    table = locale.get('alert_policy_names', {}) or {}
    return table.get(_slugify(name), name)


# ─── Security settings locale loader ───────────────────────────────────
# Localized name + security_impact + user_impact + admin_notes per setting_id
# live in security_settings_{lang}.json at project root. Cached on first read.
_SECURITY_LOCALE_CACHE = {}


def _load_security_settings_locale(project_root, lang):
    if lang in _SECURITY_LOCALE_CACHE:
        return _SECURITY_LOCALE_CACHE[lang]
    path = os.path.join(project_root, f'security_settings_{lang}.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            blob = json.load(f)
            # File structure: { "security_settings": { "<setting_id>": {...} } }
            _SECURITY_LOCALE_CACHE[lang] = blob.get('security_settings', {}) or {}
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        _SECURITY_LOCALE_CACHE[lang] = {}
    return _SECURITY_LOCALE_CACHE[lang]


def get_security_setting_meta(setting_id, project_root, lang):
    """Return {name, security_impact, user_impact, admin_notes} for a setting in the
    requested language, falling back to English on miss. Empty dict if no entry."""
    if not setting_id:
        return {}
    # Try requested lang first, then English fallback
    for try_lang in ([lang, 'en'] if lang != 'en' else ['en']):
        loc = _load_security_settings_locale(project_root, try_lang)
        entry = loc.get(setting_id)
        if entry and isinstance(entry, dict):
            return entry
    return {}


# ─── Styles ───
def create_styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        'DocSectionHeading', parent=base['Heading1'],
        fontSize=18, leading=22, textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold', spaceBefore=18, spaceAfter=10,
        # Avoid orphan headings — pull a page break before this heading if
        # it can't fit on the current page along with at least the next
        # flowable. We already PageBreak before each section, so this is
        # belt-and-suspenders for any future code that doesn't.
        keepWithNext=1,
    ))
    base.add(ParagraphStyle(
        'DocSubHeading', parent=base['Heading2'],
        fontSize=12, leading=16, textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold', spaceBefore=10, spaceAfter=6,
        # The main reason we have orphans: a sub-heading lands at the
        # bottom of a page and the table/paragraph that follows starts on
        # the next. keepWithNext=1 tells ReportLab to pull a break BEFORE
        # the sub-heading instead.
        keepWithNext=1,
    ))
    base.add(ParagraphStyle(
        'DocBody', parent=base['Normal'],
        fontSize=10, leading=14, textColor=HexColor(COLORS['text']),
        fontName='Helvetica', alignment=TA_JUSTIFY, spaceAfter=6,
    ))
    base.add(ParagraphStyle(
        'DocTableCell', parent=base['Normal'],
        fontSize=8, leading=11, textColor=HexColor(COLORS['text']),
        fontName='Helvetica', wordWrap='CJK',
    ))
    base.add(ParagraphStyle(
        'DocTableHeader', parent=base['Normal'],
        fontSize=8, leading=11, textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold',
    ))
    base.add(ParagraphStyle(
        'DocCardTitle', parent=base['Normal'],
        fontSize=8, leading=10, textColor=HexColor(COLORS['text_light']),
        fontName='Helvetica-Bold', alignment=TA_LEFT,
    ))
    base.add(ParagraphStyle(
        'DocCardValue', parent=base['Normal'],
        fontSize=18, leading=22, textColor=HexColor(COLORS['primary']),
        fontName='Helvetica-Bold', alignment=TA_LEFT,
    ))
    base.add(ParagraphStyle(
        'DocCardSubtitle', parent=base['Normal'],
        fontSize=7, leading=9, textColor=HexColor(COLORS['text_light']),
        fontName='Helvetica', alignment=TA_LEFT,
    ))
    return base


def section_line(width):
    t = Table([['']], colWidths=[width - 108], rowHeights=[1])
    t.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, HexColor(COLORS['border'])),
    ]))
    return t


def stat_card(title, value, subtitle, color, styles):
    """Build a single dashboard-style stat card as a flowable Table."""
    color_hex = color or COLORS['primary']
    title_para = Paragraph(esc(title).upper(), styles['DocCardTitle'])
    value_style = ParagraphStyle(
        'tmpVal', parent=styles['DocCardValue'], textColor=HexColor(color_hex)
    )
    value_para = Paragraph(esc(value) if value is not None else '—', value_style)
    subtitle_para = Paragraph(esc(subtitle), styles['DocCardSubtitle']) if subtitle else Spacer(1, 1)
    inner = Table([[title_para], [value_para], [subtitle_para]], colWidths=[1.7 * inch])
    inner.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    outer = Table([[inner]], colWidths=[1.85 * inch])
    outer.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, HexColor(COLORS['card_border'])),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BACKGROUND', (0, 0), (-1, -1), HexColor(COLORS['bg_card'])),
        ('LINEABOVE', (0, 0), (-1, 0), 2, HexColor(color_hex)),
    ]))
    return outer


def card_grid(cards, cols=4):
    """Lay out a list of card flowables in a grid."""
    if not cards:
        return None
    rows = []
    for i in range(0, len(cards), cols):
        row = cards[i:i + cols]
        while len(row) < cols:
            row.append('')
        rows.append(row)
    grid = Table(rows, colWidths=[1.95 * inch] * cols)
    grid.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    return grid


def std_table(headers, rows, col_widths, styles):
    """Standard data table with Panoptica style."""
    if not rows:
        return None
    header_row = [Paragraph(esc(h), styles['DocTableHeader']) for h in headers]
    table_rows = [header_row]
    for r in rows:
        table_rows.append([Paragraph(esc(c) if c is not None else '—', styles['DocTableCell']) for c in r])
    t = Table(table_rows, colWidths=col_widths)
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
    return t


# ─── Page template (footer) ───
class DocPageTemplate:
    def __init__(self, tenant_name, strings, footer_text):
        self.tenant_name = tenant_name
        self.s = strings
        self.footer_text = footer_text

    def on_page(self, canvas_obj, doc):
        canvas_obj.saveState()
        width, height = letter
        canvas_obj.setStrokeColor(HexColor(COLORS['accent']))
        canvas_obj.setLineWidth(2)
        canvas_obj.line(54, height - 45, width - 54, height - 45)
        canvas_obj.setFont('Helvetica', 7)
        canvas_obj.setFillColor(HexColor(COLORS['text_light']))
        canvas_obj.drawString(54, 30, f"{self.tenant_name} — {self.s['footer_report']}")
        canvas_obj.drawRightString(width - 54, 30,
            f"{self.s['footer_page']} {doc.page} — {self.s['footer_generated']} {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        canvas_obj.setStrokeColor(HexColor(COLORS['border']))
        canvas_obj.setLineWidth(0.5)
        canvas_obj.line(54, 42, width - 54, 42)
        canvas_obj.setFont('Helvetica', 6)
        canvas_obj.setFillColor(HexColor(COLORS['text_light']))
        canvas_obj.drawCentredString(width / 2, 18, self.footer_text)
        canvas_obj.restoreState()


# ═══════════════════════════════════════════════════════════════════
# SECTION BUILDERS
# Each one returns a list of flowables. They take (data, styles, s, lang,
# project_root) and a `story.extend(...)` happens upstream.
# ═══════════════════════════════════════════════════════════════════

def section_heading(title, styles, width):
    return KeepTogether([
        Paragraph(esc(title), styles['DocSectionHeading']),
        Spacer(1, 4),
        section_line(width),
        Spacer(1, 8),
    ])


def build_summary_cards(data, styles, s):
    svc = data.get('services', {}) or {}
    sec = svc.get('security', {}) or {}
    entra = svc.get('entra', {}) or {}
    sp = svc.get('sharepoint', {}) or {}
    od = svc.get('onedrive', {}) or {}
    exch = svc.get('exchange', {}) or {}
    teams = svc.get('teams', {}) or {}

    cards = []

    # Secure Score
    score = sec.get('secure_score') or {}
    if score.get('percentage') is not None:
        pct = float(score['percentage'])
        color = COLORS['healthy'] if pct >= 80 else COLORS['degraded'] if pct >= 60 else COLORS['broken']
        sub = ''
        if score.get('currentScore') is not None and score.get('maxScore'):
            sub = f"{score['currentScore']:.1f} / {score['maxScore']:.1f}"
        cards.append(stat_card(s['card_secure_score'], f"{pct:.2f}%", sub, color, styles))

    # Users
    us = entra.get('user_summary') or {}
    if us.get('total') is not None:
        cards.append(stat_card(s['card_users_total'], fmt_num(us['total']),
            f"{s['card_users_licensed']}: {fmt_num(us.get('licensed'))} · {s['card_users_unlicensed']}: {fmt_num(us.get('unlicensed'))}",
            COLORS['primary'], styles))

    # Global admins
    ga = sec.get('global_admins') or {}
    if ga.get('count') is not None:
        cnt = ga['count']
        color = COLORS['broken'] if cnt > 5 else COLORS['degraded'] if cnt > 2 else COLORS['healthy']
        cards.append(stat_card(s['card_global_admins'], fmt_num(cnt), '', color, styles))

    # CA policies
    ca = sec.get('conditional_access')
    if isinstance(ca, list):
        enabled = sum(1 for p in ca if p.get('state') == 'enabled')
        cards.append(stat_card(s['card_ca_policies'], fmt_num(len(ca)),
            f"{enabled} {s['card_ca_enabled']}", COLORS['primary'], styles))

    # Security Defaults
    sd = sec.get('security_defaults')
    if isinstance(sd, dict) and sd.get('isEnabled') is not None:
        is_on = bool(sd['isEnabled'])
        cards.append(stat_card(s['card_security_defaults'],
            s['status_enabled'] if is_on else s['status_disabled'], '',
            COLORS['healthy'] if is_on else COLORS['broken'], styles))

    # MFA
    mfa = sec.get('mfa_status') or {}
    if mfa.get('total_users'):
        pct = mfa.get('registration_percentage') or 0
        color = COLORS['healthy'] if pct >= 90 else COLORS['degraded'] if pct >= 70 else COLORS['broken']
        cards.append(stat_card(s['card_mfa'], f"{fmt_pct(pct)}%",
            s['card_subtitle_missing'].format(n=fmt_num(mfa.get('mfa_not_registered', 0))),
            color, styles))

    # Devices
    dc = entra.get('device_counts') or {}
    if dc.get('total') is not None:
        sub = s['card_subtitle_compliant'].format(
            n=fmt_num(dc.get('compliant')),
            total=fmt_num(dc.get('compliant_applicable') or dc.get('total')))
        cards.append(stat_card(s['card_devices'], fmt_num(dc['total']), sub, COLORS['primary'], styles))
        managed_total = dc.get('managed_applicable') or dc.get('total')
        cards.append(stat_card(s['card_devices_managed'],
            s['card_subtitle_managed'].format(n=fmt_num(dc.get('managed')), total=fmt_num(managed_total)),
            '',
            COLORS['healthy'] if dc.get('managed') == managed_total else COLORS['degraded'], styles))

    # SharePoint
    spc = sp.get('sharepoint_counts') or {}
    if spc.get('total_sites') is not None:
        sub = s['card_subtitle_files'].format(
            gb=fmt_pct(spc.get('total_storage_gb')),
            files=fmt_num(spc.get('total_files')))
        cards.append(stat_card(s['card_sp_sites'], fmt_num(spc['total_sites']), sub, COLORS['primary'], styles))
        if spc.get('total_anonymous_links', 0) > 0:
            cards.append(stat_card(s['card_anon_links'], fmt_num(spc['total_anonymous_links']),
                s['card_subtitle_anon_sites'].format(n=fmt_num(spc.get('sites_with_anonymous_links'))),
                COLORS['broken'], styles))

    # OneDrive
    odc = od.get('onedrive_counts') or {}
    if odc.get('total_accounts') is not None:
        cards.append(stat_card(s['card_onedrive'], fmt_num(odc['total_accounts']),
            s['card_subtitle_storage_gb'].format(gb=fmt_pct(odc.get('total_storage_gb'))),
            COLORS['primary'], styles))

    # Mailboxes
    mc = exch.get('mailbox_counts') or {}
    if mc.get('total') is not None:
        cards.append(stat_card(s['card_mailboxes'], fmt_num(mc['total']),
            s['card_subtitle_storage_gb'].format(gb=fmt_pct(mc.get('total_storage_gb'))),
            COLORS['primary'], styles))

    # Teams
    tc = teams.get('teams_counts') or {}
    if tc.get('total') is not None:
        cards.append(stat_card(s['card_teams'], fmt_num(tc['total']),
            s['card_subtitle_teams'].format(pub=fmt_num(tc.get('public')), pri=fmt_num(tc.get('private'))),
            COLORS['primary'], styles))

    # Inbox rules
    mf = exch.get('mail_forwarding') or {}
    all_rules = mf.get('allRules') or []
    if all_rules:
        cards.append(stat_card(s['card_inbox_rules'], fmt_num(len(all_rules)), '', COLORS['primary'], styles))

    # Risky users
    rc = sec.get('risky_user_counts') or {}
    if rc.get('total', 0) > 0:
        cards.append(stat_card(s['card_risky_users'], fmt_num(rc['total']),
            s['card_subtitle_risky'].format(high=fmt_num(rc.get('high')), medium=fmt_num(rc.get('medium'))),
            COLORS['broken'], styles))

    # Inactive users
    iu = entra.get('inactive_users') or {}
    int_ct = len(iu.get('internalInactive') or [])
    ext_ct = len(iu.get('externalInactive') or [])
    if int_ct + ext_ct > 0:
        cards.append(stat_card(s['card_inactive_users'], fmt_num(int_ct + ext_ct),
            s['card_subtitle_inactive'].format(int_n=int_ct, ext_n=ext_ct),
            COLORS['degraded'] if int_ct > 0 else COLORS['primary'], styles))

    # Stale devices
    id_ = entra.get('inactive_devices') or {}
    inactive = id_.get('inactive') or []
    if inactive:
        cards.append(stat_card(s['card_stale_devices'], fmt_num(len(inactive)), '',
            COLORS['degraded'], styles))

    # Apps
    reg_apps = entra.get('registered_apps')
    if reg_apps:
        cards.append(stat_card(s['card_apps_registered'], fmt_num(len(reg_apps)), '', COLORS['primary'], styles))
    ent_apps = entra.get('enterprise_apps')
    if ent_apps:
        cards.append(stat_card(s['card_apps_enterprise'], fmt_num(len(ent_apps)), '', COLORS['primary'], styles))

    # Domains
    domains = sp.get('domains') or []
    if domains:
        cards.append(stat_card(s['card_domains'], fmt_num(len(domains)), '', COLORS['primary'], styles))

    return cards


def build_section_licensing(data, styles, s, width, lang):
    """Licenses + unlicensed users."""
    flows = []
    entra = (data.get('services') or {}).get('entra', {}) or {}
    licenses = entra.get('licenses') or []
    if not licenses:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    rows = [[
        l.get('displayName', ''),
        localize_enum(l.get('status', ''), LICENSE_STATUS_LABELS, lang),
        fmt_num(l.get('assigned')),
        fmt_num(l.get('total')),
        fmt_num(l.get('available')),
    ] for l in licenses]
    t = std_table(
        [s['col_name'], s['col_status'], s['col_assigned'], s['col_total'], s['col_available']],
        rows, [220, 80, 60, 60, 70], styles
    )
    if t:
        flows.append(t)
        flows.append(Spacer(1, 8))

    unlic = entra.get('unlicensedUsers') or []
    if unlic:
        flows.append(Paragraph(f"<b>{esc(s['card_users_unlicensed'])}</b>", styles['DocSubHeading']))
        rows2 = [[u.get('displayName', ''), u.get('userPrincipalName', ''),
                  '✓' if u.get('enabled') else '✗'] for u in unlic]
        t2 = std_table([s['col_name'], s['col_upn'], s['col_enabled']],
                       rows2, [200, 240, 50], styles)
        if t2:
            flows.append(t2)
    return flows


def build_section_users(data, styles, s, width, lang):
    flows = []
    entra = (data.get('services') or {}).get('entra', {}) or {}
    sec = (data.get('services') or {}).get('security', {}) or {}

    # Accounts with admin roles — EVERY account holding any watched privileged
    # role (not just Global Admins), from the always-polled privileged_roles
    # reader (fetchers.fetchPrivilegedRoles → sec.privileged_roles). Replaces the
    # old GA-only list: Microfix correctly noted the report listed only Global
    # Admins. The GA *count* still appears as a summary KPI card. Falls back to
    # the legacy global_admins list if privileged_roles isn't present (older snap).
    priv = sec.get('privileged_roles') or {}
    priv_accounts = priv.get('accounts') or []
    if priv_accounts:
        def _mfa(v):
            mr = v.get('mfaRegistered')
            return '✓' if mr is True else ('✗' if mr is False else '—')
        flows.append(Paragraph(
            f"<b>{esc(s['er_sec_admins'])} ({len(priv_accounts)})</b>", styles['DocSubHeading']))
        rows = [[a.get('displayName') or a.get('userPrincipalName', ''),
                 ', '.join(r.get('name', '') for r in (a.get('roles') or []) if r.get('name')) or '—',
                 '✓' if a.get('enabled') else '✗',
                 _mfa(a)] for a in priv_accounts]
        t = std_table([s['col_name'], s['er_col_roles'], s['col_enabled'], s['er_col_mfa']],
                      rows, [150, 210, 50, 80], styles)
        if t:
            flows.append(t)
            flows.append(Spacer(1, 8))
    else:
        # Fallback for older snapshots without privileged_roles: legacy GA list.
        ga = sec.get('global_admins') or {}
        admins = ga.get('admins') or []
        if admins:
            flows.append(Paragraph(f"<b>{esc(s['card_global_admins'])} ({len(admins)})</b>", styles['DocSubHeading']))
            rows = [[a.get('displayName', ''), a.get('userPrincipalName', ''),
                     '✓' if a.get('enabled') else '✗',
                     '✓' if a.get('licensed') else '✗'] for a in admins]
            t = std_table([s['col_name'], s['col_upn'], s['col_enabled'], s['col_lic_short']],
                          rows, [180, 230, 40, 40], styles)
            if t:
                flows.append(t)
                flows.append(Spacer(1, 8))

    # Helper to format the lastSignIn value the same way the dashboard does:
    # the literal string 'Never' is the API's signal for "never signed in" —
    # localize that one value; ISO timestamps render as YYYY-MM-DD.
    def _fmt_last(last):
        if last in (None, '', 'Never'):
            return s['col_never']
        return str(last)[:10]

    # Inactive users — SPLIT into internal vs guest, mirroring the dashboard's
    # two separate panels. Internal users get an extra "Licensed" column.
    # Sign-in activity requires Entra ID P1; users without P1 may not be evaluable
    # (see fetcher classification). When evaluable users == 0 but unavailable > 0,
    # we still surface a heading + note so the operator knows the data exists.
    iu = entra.get('inactive_users') or {}
    inactive_int = iu.get('internalInactive') or []
    inactive_ext = iu.get('externalInactive') or []
    int_unavail = iu.get('internalDataUnavailable') or 0
    ext_unavail = iu.get('externalDataUnavailable') or 0
    base_signin_note = s.get('inactive_signin_note_pdf', '')

    def _append_signin_note(unavail_count):
        """Append the base P1 note plus a count addendum if unavailable users exist."""
        note = base_signin_note
        if unavail_count > 0:
            note += ' ' + s['inactive_signin_unavailable_note_pdf'].format(count=unavail_count)
        if note:
            flows.append(Paragraph(f"<i>{esc(note)}</i>", styles['DocBody']))

    if inactive_int:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_inactive_internal'].format(n=len(inactive_int)))}</b>",
            styles['DocSubHeading']))
        rows = []
        for u in inactive_int[:60]:
            rows.append([
                u.get('displayName', ''),
                u.get('userPrincipalName', ''),
                _fmt_last(u.get('lastSignIn')),
                '✓' if u.get('licensed') else '✗',
            ])
        t = std_table(
            [s['col_name'], s['col_upn'], s['col_last_signin'], s['col_licensed']],
            rows, [160, 220, 90, 50], styles)
        if t:
            flows.append(t)
            if len(inactive_int) > 60:
                flows.append(Paragraph(
                    f"<i>{s['more_rows'].format(count=len(inactive_int) - 60)}</i>",
                    styles['DocBody']))
            _append_signin_note(int_unavail)
            flows.append(Spacer(1, 8))
    elif int_unavail > 0:
        # No verifiable inactive internal users, but some could not be evaluated.
        flows.append(Paragraph(
            f"<b>{esc(s['sub_inactive_unavailable_internal'])}</b>",
            styles['DocSubHeading']))
        _append_signin_note(int_unavail)
        flows.append(Spacer(1, 8))

    if inactive_ext:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_inactive_guests'].format(n=len(inactive_ext)))}</b>",
            styles['DocSubHeading']))
        rows = []
        for u in inactive_ext[:60]:
            rows.append([
                u.get('displayName', ''),
                u.get('userPrincipalName', ''),
                _fmt_last(u.get('lastSignIn')),
            ])
        t = std_table(
            [s['col_name'], s['col_upn'], s['col_last_signin']],
            rows, [170, 240, 90], styles)
        if t:
            flows.append(t)
            if len(inactive_ext) > 60:
                flows.append(Paragraph(
                    f"<i>{s['more_rows'].format(count=len(inactive_ext) - 60)}</i>",
                    styles['DocBody']))
            _append_signin_note(ext_unavail)
            flows.append(Spacer(1, 8))
    elif ext_unavail > 0:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_inactive_unavailable_guests'])}</b>",
            styles['DocSubHeading']))
        _append_signin_note(ext_unavail)
        flows.append(Spacer(1, 8))

    # Risky users — mirrors dashboard's separate panel. Only renders when
    # tenant has any (P2 feature; absent on Business Premium-only tenants).
    risky = sec.get('risky_users') or []
    if risky:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_risky_users'].format(n=len(risky)))}</b>",
            styles['DocSubHeading']))
        rows = []
        for u in risky[:60]:
            rows.append([
                u.get('name', '') or u.get('displayName', ''),
                u.get('upn', '') or u.get('userPrincipalName', ''),
                u.get('riskLevel', '') or '—',
                u.get('riskState', '') or '—',
            ])
        t = std_table(
            [s['col_name'], s['col_upn'], s['col_risk_level'], s['col_risk_state']],
            rows, [150, 220, 70, 70], styles)
        if t:
            flows.append(t)

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_mfa(data, styles, s, width, lang):
    flows = []
    sec = (data.get('services') or {}).get('security', {}) or {}
    mfa = sec.get('mfa_status') or {}
    not_reg = sec.get('mfa_not_registered_users') or []

    if mfa.get('total_users') is not None:
        flows.append(Paragraph(
            s['mfa_intro'].format(
                total=fmt_num(mfa.get('total_users')),
                pct=fmt_pct(mfa.get('registration_percentage')),
                missing=fmt_num(mfa.get('mfa_not_registered')),
            ),
            styles['DocBody']
        ))

    if not_reg:
        flows.append(Spacer(1, 6))
        rows = [[u.get('name', ''), u.get('upn', '')] for u in not_reg]
        t = std_table([s['col_name'], s['col_upn']], rows[:80], [200, 280], styles)
        if t:
            flows.append(t)
            if len(not_reg) > 80:
                flows.append(Paragraph(f"<i>{s['more_rows'].format(count=len(not_reg) - 80)}</i>", styles['DocBody']))

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_ca(data, styles, s, width, lang):
    """Per-policy subsections. For each CA policy: subheading (policy name) +
    state badge + Haiku-generated plain-language summary + condensed
    structured details (state, conditions, controls)."""
    flows = []
    # Prefer the enriched policy list from gatherCaPolicies (top-level
    # caPolicies) since it has resolved GUIDs. Fall back to the snapshot
    # version (services.security.conditional_access) which is summary-only.
    ca = data.get('caPolicies') or []
    if not ca:
        sec = (data.get('services') or {}).get('security', {}) or {}
        ca = sec.get('conditional_access') or []
    if not ca:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    # Build a name → summary lookup from Haiku output (caPolicySummaries).
    summaries_by_name = {}
    for entry in (data.get('caPolicySummaries') or []):
        if isinstance(entry, dict) and entry.get('name'):
            summaries_by_name[entry['name']] = entry.get('summary') or ''

    state_color = {
        'enabled': COLORS['healthy'],
        'disabled': COLORS['broken'],
        'enabledForReportingButNotEnforced': COLORS['degraded'],
    }

    for p in ca:
        # Build the entire per-policy block as a list, then wrap in
        # KeepTogether so the heading + summary + details either stay on
        # one page or move as a unit to the next. Without this, ReportLab
        # happily orphans the heading at the bottom of a page.
        block = []

        # Both gatherCaPolicies (from api-reports.js) and the snapshot variant
        # use displayName. Some snapshots use 'name'. Try both.
        policy_name = p.get('displayName') or p.get('name') or '(unnamed)'
        state = p.get('state') or ''
        state_label = localize_enum(state, CA_STATE_LABELS, lang)
        state_clr = state_color.get(state, COLORS['text_light'])

        # Subheading: policy name + state badge
        title_html = (
            f'<b>{esc(policy_name)}</b>  '
            f'<font color="{state_clr}" size="9">● {esc(state_label)}</font>'
        )
        block.append(Paragraph(title_html, styles['DocSubHeading']))

        # Haiku-generated summary if available
        summary = summaries_by_name.get(policy_name, '')
        if summary:
            block.append(Paragraph(esc(summary), styles['DocBody']))

        # Structured detail line — extract a readable summary from the
        # policy structure if available. The enriched gatherCaPolicies
        # output has users/applications/locations/etc as resolved arrays.
        detail_bits = []
        users = p.get('users') or {}
        if users:
            inc = users.get('include') or []
            inc_g = users.get('includeGroups') or []
            inc_r = users.get('includeRoles') or []
            who = ', '.join(filter(None, (
                ', '.join(inc[:3]) if inc else '',
                ', '.join(inc_g[:3]) if inc_g else '',
                ', '.join(inc_r[:3]) if inc_r else '',
            )))
            if who:
                detail_bits.append(f"<b>{esc(s['col_user'])}:</b> {esc(who)}")
        apps = p.get('applications') or {}
        if apps:
            inc = apps.get('include') or []
            if inc:
                detail_bits.append(f"<b>Apps:</b> {esc(', '.join(inc[:3]))}")
        locs = p.get('locations') or {}
        if locs:
            inc = locs.get('include') or []
            exc = locs.get('exclude') or []
            if inc or exc:
                loc_str = ''
                if inc:
                    loc_str += '+' + ', '.join(inc[:2])
                if exc:
                    loc_str += ' −' + ', '.join(exc[:2])
                detail_bits.append(f"<b>Locations:</b> {esc(loc_str)}")
        gc = p.get('grantControls') or {}
        if gc:
            built = gc.get('builtInControls') or []
            if built:
                detail_bits.append(f"<b>{esc(s['col_controls'])}:</b> {esc(', '.join(built))}")
        # Fallback to the simple condensed strings (from older snapshot shape)
        if not detail_bits:
            if p.get('conditions'):
                detail_bits.append(f"<b>{esc(s['col_conditions'])}:</b> {esc(str(p.get('conditions'))[:300])}")
            if p.get('controls'):
                detail_bits.append(f"<b>{esc(s['col_controls'])}:</b> {esc(str(p.get('controls'))[:300])}")
        if detail_bits:
            block.append(Paragraph(
                '<font size="8" color="#666666">' + '<br/>'.join(detail_bits) + '</font>',
                styles['DocBody']
            ))

        # Wrap as a unit. If the block is genuinely too tall for one page
        # (rare — would take a multi-paragraph summary), ReportLab falls
        # back to splitting it; no infinite-page-break risk.
        flows.append(KeepTogether(block))
        flows.append(Spacer(1, 6))

    return flows


def build_section_security_settings(data, styles, s, width, lang):
    """Per-setting subsections grouped by category. Each setting:
    subheading (localized name) + status pill + 1-2 sentence description
    pulled from security_settings_{lang}.json."""
    flows = []
    settings = data.get('securitySettings') or []
    if not settings:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    # Group by category in canonical order, preserving priority order within.
    category_order = ['exchange', 'identity', 'sharepoint', 'teams', 'defender', 'compliance']
    by_category = {cat: [] for cat in category_order}
    for st in settings:
        cat = st.get('category') or 'compliance'
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(st)

    pri_color = {
        'critical': COLORS['broken'],
        'high': COLORS['degraded'],
        'medium': COLORS['primary'],
        'low': COLORS['text_light'],
    }

    first = True
    for cat in category_order:
        cat_settings = by_category.get(cat) or []
        if not cat_settings:
            continue
        # Category sub-heading
        if not first:
            flows.append(Spacer(1, 8))
        first = False
        cat_label = localize_enum(cat, SETTING_CATEGORY_LABELS, lang)
        cat_heading = Paragraph(f"<b>{esc(cat_label)}</b>", styles['DocSubHeading'])

        for idx, st in enumerate(cat_settings):
            setting_id = st.get('setting_id', '')
            status_key = st.get('status', '')
            priority = st.get('priority', '')
            meta = get_security_setting_meta(setting_id, project_root, lang)
            # Localized name from security_settings_{lang}.json, fallback to DB name
            name = meta.get('name') or st.get('name', '') or setting_id
            description = meta.get('security_impact') or ''

            status_label = s.get(SETTING_STATUS_LABELS.get(status_key, ''), status_key)
            status_color = SETTING_STATUS_COLORS.get(status_key, COLORS['text_light'])
            pri_label_str = localize_enum(priority, SETTING_PRIORITY_LABELS, lang)
            pri_color_hex = pri_color.get(priority, COLORS['text_light'])

            # Title line: setting name + status badge + priority hint
            title_html = (
                f'<b>{esc(name)}</b>  '
                f'<font color="{status_color}" size="9">● {esc(status_label)}</font>  '
                f'<font color="{pri_color_hex}" size="8">[{esc(pri_label_str)}]</font>'
            )

            # Wrap setting title + description as a unit so they don't split
            # across pages. Same pattern as the per-policy CA blocks.
            block = [Paragraph(title_html, styles['DocBody'])]
            if description:
                block.append(Paragraph(esc(description), styles['DocBody']))
            # Glue the category sub-heading to its FIRST setting so the heading
            # never strands alone at the foot of a page (flat KeepTogether — no
            # nesting). Subsequent settings are their own keep-together blocks.
            if idx == 0:
                flows.append(KeepTogether([cat_heading] + block))
            else:
                flows.append(KeepTogether(block))
            flows.append(Spacer(1, 4))

    return flows


def build_section_exemptions(data, styles, s, width, project_root, lang):
    flows = []
    ex = data.get('exemptions') or []
    if not ex:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    rows = []
    for r in ex:
        match_extra = []
        if r.get('match_country'):
            match_extra.append(f"country={r['match_country']}")
        if r.get('match_ip_cidr'):
            match_extra.append(f"cidr={r['match_ip_cidr']}")
        match_str = (r.get('match_upn') or '*') + (f" ({', '.join(match_extra)})" if match_extra else '')
        rows.append([
            localize_policy_name(r.get('policy_name', ''), project_root, lang),
            match_str,
            (r.get('reason') or '')[:140],
            fmt_num(r.get('match_count')),
            (str(r.get('expires_at') or ''))[:10],
        ])
    t = std_table(
        [s['col_policy'], s['col_match_criteria'], s['col_description'],
         s['col_match_count'], s['col_expires']],
        rows, [110, 110, 165, 50, 65], styles
    )
    if t:
        flows.append(t)
    return flows


def build_section_recent_changes(data, styles, s, width, lang):
    flows = []
    changes = data.get('recentChanges') or []
    if not changes:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    rows = []
    for c in changes:
        surface = c.get('affected_surface')
        if isinstance(surface, list):
            surface = ','.join(surface)
        rows.append([
            (str(c.get('started_at') or ''))[:16],
            c.get('category', ''),
            (c.get('description') or '')[:160],
            c.get('created_by') or c.get('source') or '',
        ])
    t = std_table(
        [s['col_when'], s['col_category'], s['col_description'], s['col_who']],
        rows, [85, 90, 230, 95], styles
    )
    if t:
        flows.append(t)
    return flows


def build_section_domains(data, styles, s, width, lang):
    flows = []
    sp = (data.get('services') or {}).get('sharepoint', {}) or {}
    domains = sp.get('domains') or []
    if not domains:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    rows = []
    for d in domains:
        flags = []
        if d.get('isDefault'):
            flags.append(localize_enum('default', DOMAIN_FLAG_LABELS, lang))
        if d.get('isVerified'):
            flags.append(localize_enum('verified', DOMAIN_FLAG_LABELS, lang))
        rows.append([
            d.get('name', ''),
            ', '.join(flags) if flags else '—',
            localize_enum(d.get('authenticationType', '') or '—', DOMAIN_AUTH_TYPE_LABELS, lang),
        ])
    t = std_table([s['col_name'], s['col_flags'], s['col_auth_type']],
                  rows, [240, 130, 130], styles)
    if t:
        flows.append(t)

    # DNS records nested per default domain
    for d in domains:
        if d.get('isDefault') and d.get('dnsRecordStatus'):
            flows.append(Spacer(1, 8))
            flows.append(Paragraph(
                f"<b>{esc(s['sub_dns_for'].format(domain=d.get('name', '')))}</b>",
                styles['DocSubHeading']))
            dns_rows = [[r.get('type', ''), r.get('service', ''),
                         (r.get('expectedValue') or '')[:80],
                         localize_enum(r.get('status', ''), DNS_STATUS_LABELS, lang)]
                        for r in d['dnsRecordStatus']]
            t2 = std_table([s['col_type'], s['col_service'], s['col_expected'], s['col_status']],
                          dns_rows, [50, 80, 280, 80], styles)
            if t2:
                flows.append(t2)
    return flows


def build_section_email_auth(data, styles, s, width, project_root, lang):
    """Email-authentication posture for the primary sending domain (cached read,
    no live DNS pull). Table-style, no gauge — matches this report's documentary
    look. Other mail domains as a compact grade list; informational/non-mail noted."""
    flows = []
    email_auth = (data.get('enrichment') or {}).get('emailAuth') or {}
    primary = email_auth.get('primary') or {}
    if (not email_auth.get('available')) or (not primary):
        flows.append(Paragraph(s['email_auth_unavailable'], styles['DocBody']))
        return flows

    flows.append(Paragraph(s['email_auth_intro'], styles['DocBody']))
    flows.append(Spacer(1, 6))

    # Headline: "<domain> — Grade B (78/100)" + caption (no gauge in this report).
    grade_word = email_auth_label(project_root, lang, 'grade')
    score = primary.get('overall_score')
    score_str = f"{score}/100" if score is not None else '—'
    headline = (f"<b>{esc(primary.get('domain') or '—')}</b> — "
                f"{esc(grade_word)} {esc(str(primary.get('grade') or '—'))} ({esc(score_str)})")
    flows.append(Paragraph(headline, styles['DocBody']))
    caption = email_auth_label(project_root, lang,
                               'non_mail_domain' if primary.get('non_mail') else 'gauge_caption')
    flows.append(Paragraph(f"<font size='8' color='#666666'>{esc(caption)}</font>", styles['DocBody']))
    provs = ((primary.get('detected_providers') or {}).get('all')) or []
    if provs:
        flows.append(Paragraph(
            f"<font size='8' color='#666666'>"
            f"{esc(email_auth_label(project_root, lang, 'detected_providers', {'providers': ', '.join(provs)}))}</font>",
            styles['DocBody']))
    flows.append(Spacer(1, 6))

    # Per-mechanism table (shared findings→rows mapping; DKIM stays 3-state).
    rows = [list(r) for r in mechanism_rows(primary.get('findings') or {}, project_root, lang)]
    # Fixed, narrower widths (not full content width) — a 3-column status table
    # stretched edge-to-edge looks empty/silly; keep it compact and left-aligned.
    t = std_table([s['ea_col_mechanism'], s['ea_col_status'], s['ea_col_detail']],
                  rows, [85, 80, 260], styles)
    if t:
        t.hAlign = 'LEFT'  # flush with the left margin (ReportLab centers tables by default)
        flows.append(t)
        flows.append(Spacer(1, 8))

    # Other mail domains — compact one-line-per-domain list (no per-domain table).
    others = email_auth.get('others') or []
    if others:
        other_heading = Paragraph(f"<b>{esc(s['email_auth_other_domains'])}</b>", styles['DocSubHeading'])
        lines = []
        for o in others:
            tag = ''
            if o.get('non_mail'):
                tag = ' · ' + esc(email_auth_label(project_root, lang, 'non_mail_domain'))
            lines.append(f"{esc(o.get('domain') or '—')} — {esc(str(o.get('grade') or ''))} "
                         f"({esc(str(o.get('overall_score', 0)))}){tag}")
        # Glue the sub-heading to its list so it never strands at a page bottom.
        flows.append(KeepTogether([other_heading, Paragraph('<br/>'.join(lines), styles['DocBody'])]))
        flows.append(Spacer(1, 6))

    # Non-mail advisory + informational (onmicrosoft) domains.
    nonmail = []
    if primary.get('non_mail') and primary.get('domain'):
        nonmail.append(primary.get('domain'))
    nonmail += [o.get('domain') for o in others if o.get('non_mail') and o.get('domain')]
    if nonmail:
        flows.append(Paragraph(
            f"<font size='8' color='#666666'>"
            f"{esc(s['email_auth_nonmail_note'].replace('{domains}', ', '.join(nonmail)))}</font>",
            styles['DocBody']))
    info = email_auth.get('informational') or []
    if info:
        flows.append(Paragraph(
            f"<font size='8' color='#666666'>"
            f"{esc(email_auth_label(project_root, lang, 'informational_domains', {'domains': ', '.join(info)}))}</font>",
            styles['DocBody']))

    return flows


def build_section_devices(data, styles, s, width, lang):
    flows = []
    entra = (data.get('services') or {}).get('entra', {}) or {}
    dc = entra.get('device_counts') or {}
    by_os = dc.get('by_os') or {}

    if by_os:
        flows.append(Paragraph(f"<b>{esc(s['sub_devices_by_os'])}</b>", styles['DocSubHeading']))
        rows = [[os_, fmt_num(cnt)] for os_, cnt in sorted(by_os.items(), key=lambda kv: -kv[1])]
        t = std_table([s['col_os'], s['col_count']], rows, [350, 100], styles)
        if t:
            flows.append(t)
            flows.append(Spacer(1, 8))

    intune = entra.get('intune_devices') or []
    if intune:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_intune_devices'].format(count=len(intune)))}</b>",
            styles['DocSubHeading']))
        rows = [[d.get('deviceName', ''), d.get('os', ''),
                 localize_enum(d.get('complianceState') or '—', COMPLIANCE_STATE_LABELS, lang),
                 d.get('user') or '—',
                 (str(d.get('lastSync') or ''))[:10]]
                for d in intune[:80]]
        t = std_table([s['col_device'], s['col_os'], s['col_compliance'], s['col_user'], s['col_last_sync']],
                      rows, [120, 60, 80, 130, 70], styles)
        if t:
            flows.append(t)
            if len(intune) > 80:
                flows.append(Paragraph(f"<i>{s['more_rows'].format(count=len(intune) - 80)}</i>", styles['DocBody']))
            flows.append(Spacer(1, 8))

    # Stale Devices — mirrors dashboard panel. Inactive >90d, regardless of
    # whether they're Intune-managed. Trust type indicates whether the device
    # is Entra-joined, hybrid-joined, or registered.
    id_ = entra.get('inactive_devices') or {}
    inactive_devs = id_.get('inactive') or []
    if inactive_devs:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_stale_devices'].format(n=len(inactive_devs)))}</b>",
            styles['DocSubHeading']))
        rows = []
        for d in inactive_devs[:80]:
            last = d.get('lastActivity')
            if last in (None, '', 'Never'):
                last_display = s['col_never']
            else:
                last_display = str(last)[:10]
            rows.append([
                d.get('displayName', ''),
                d.get('os', '') or '—',
                last_display,
                d.get('trustType', '') or '—',
            ])
        t = std_table(
            [s['col_device'], s['col_os'], s['col_last_activity'], s['col_trust_type']],
            rows, [180, 80, 90, 110], styles)
        if t:
            flows.append(t)
            if len(inactive_devs) > 80:
                flows.append(Paragraph(
                    f"<i>{s['more_rows'].format(count=len(inactive_devs) - 80)}</i>",
                    styles['DocBody']))

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_sharepoint(data, styles, s, width, lang):
    flows = []
    sp = (data.get('services') or {}).get('sharepoint', {}) or {}
    sites = sp.get('sharepoint_sites') or []
    anon = sp.get('anonymous_links') or []

    if sites:
        rows = []
        for site in sites[:60]:
            gb = (site.get('storageUsedBytes') or 0) / (1024 ** 3)
            rows.append([
                site.get('siteName', ''),
                fmt_num(site.get('fileCount')),
                f"{gb:.2f} GB",
                fmt_num(site.get('pageViewCount')),
                site.get('lastActivityDate') or '—',
            ])
        t = std_table(
            [s['col_site'], s['col_files'], s['col_storage'], s['col_views'], s['col_last_active']],
            rows, [180, 60, 80, 60, 80], styles)
        if t:
            flows.append(t)
            if len(sites) > 60:
                flows.append(Paragraph(f"<i>{s['more_rows'].format(count=len(sites) - 60)}</i>", styles['DocBody']))

    if anon:
        flows.append(Spacer(1, 8))
        flows.append(Paragraph(f"<b>{esc(s['sub_anon_links'])}</b>", styles['DocSubHeading']))
        anon_rows = [[a.get('siteName', ''),
                      fmt_num(a.get('anonymousLinkCount')),
                      fmt_num(a.get('companyLinkCount'))]
                     for a in sorted(anon, key=lambda x: -(x.get('anonymousLinkCount') or 0))[:40]]
        t2 = std_table([s['col_site'], s['col_anonymous'], s['col_company']], anon_rows, [260, 90, 90], styles)
        if t2:
            flows.append(t2)

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_exchange(data, styles, s, width, lang):
    flows = []
    exch = (data.get('services') or {}).get('exchange', {}) or {}
    mboxes = exch.get('mailbox_usage') or []
    mail_act = exch.get('mail_activity') or []

    if mboxes:
        flows.append(Paragraph(f"<b>{esc(s['sub_top_mailboxes'])}</b>", styles['DocSubHeading']))
        rows = [[m.get('displayName') or m.get('upn', ''),
                 fmt_num(m.get('itemCount')),
                 f"{(m.get('storageUsedBytes') or 0) / (1024 ** 2):.1f} MB",
                 m.get('lastActivity') or '—']
                for m in mboxes[:30]]
        t = std_table([s['col_user'], s['col_items'], s['col_storage'], s['col_last_active']],
                      rows, [220, 70, 80, 80], styles)
        if t:
            flows.append(t)
            flows.append(Spacer(1, 8))

    if mail_act:
        flows.append(Paragraph(f"<b>{esc(s['sub_mail_activity'])}</b>", styles['DocSubHeading']))
        rows = [[a.get('date') or '—', fmt_num(a.get('send')),
                 fmt_num(a.get('receive')), fmt_num(a.get('read'))]
                for a in mail_act]
        t = std_table([s['col_date'], s['col_sent'], s['col_received'], s['col_read']],
                      rows, [100, 80, 80, 80], styles)
        if t:
            flows.append(t)

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_inbox_rules(data, styles, s, width, lang):
    flows = []
    exch = (data.get('services') or {}).get('exchange', {}) or {}
    mf = exch.get('mail_forwarding') or {}
    forwarding = mf.get('rules') or []
    all_rules = mf.get('allRules') or []

    if forwarding:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_forwarding_rules'].format(count=len(forwarding)))}</b>",
            styles['DocSubHeading']))
        rows = [[r.get('user', ''), r.get('ruleName', ''),
                 ', '.join(r.get('targets') or [])[:100],
                 s['inbox_rule_external'] if r.get('isExternal') else s['inbox_rule_internal']]
                for r in forwarding[:60]]
        t = std_table([s['col_user'], s['col_rule'], s['col_target'], s['col_type']],
                      rows, [110, 110, 200, 60], styles)
        if t:
            flows.append(t)
            flows.append(Spacer(1, 8))

    if all_rules:
        flows.append(Paragraph(
            f"<b>{esc(s['sub_all_inbox_rules'].format(count=len(all_rules)))}</b>",
            styles['DocSubHeading']))
        flows.append(Paragraph(s['inbox_rules_summary_note'], styles['DocBody']))

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_teams(data, styles, s, width, lang):
    flows = []
    teams = (data.get('services') or {}).get('teams', {}) or {}
    teams_list = teams.get('teams_list') or []
    if not teams_list:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows
    rows = [[t.get('name', ''),
             localize_enum(t.get('visibility', '') or '—', TEAMS_VISIBILITY_LABELS, lang),
             (str(t.get('created') or ''))[:10]]
            for t in sorted(teams_list, key=lambda x: x.get('name', '') or '')]
    t = std_table([s['col_name'], s['col_visibility'], s['col_created']],
                  rows, [280, 110, 100], styles)
    if t:
        flows.append(t)
    return flows


def build_section_apps(data, styles, s, width, lang):
    flows = []
    entra = (data.get('services') or {}).get('entra', {}) or {}
    reg = entra.get('registered_apps') or []
    ent = entra.get('enterprise_apps') or []

    if reg:
        flows.append(Paragraph(f"<b>{esc(s['card_apps_registered'])} ({len(reg)})</b>", styles['DocSubHeading']))
        rows = [[a.get('displayName', ''), a.get('appId') or '—',
                 (str(a.get('createdDateTime') or ''))[:10]]
                for a in reg[:80]]
        t = std_table([s['col_name'], s['col_app_id'], s['col_created']],
                      rows, [200, 220, 90], styles)
        if t:
            flows.append(t)
            if len(reg) > 80:
                flows.append(Paragraph(f"<i>{s['more_rows'].format(count=len(reg) - 80)}</i>", styles['DocBody']))
            flows.append(Spacer(1, 8))

    if ent:
        flows.append(Paragraph(f"<b>{esc(s['card_apps_enterprise'])} ({len(ent)})</b>", styles['DocSubHeading']))
        rows = [[a.get('displayName', ''), a.get('appId') or '—',
                 ', '.join((a.get('signInAudience') or '').split(',')[:2]) or '—']
                for a in ent[:80]]
        t = std_table([s['col_name'], s['col_app_id'], s['col_audience']],
                      rows, [200, 220, 90], styles)
        if t:
            flows.append(t)
            if len(ent) > 80:
                flows.append(Paragraph(f"<i>{s['more_rows'].format(count=len(ent) - 80)}</i>", styles['DocBody']))

    if not flows:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
    return flows


def build_section_identity(data, styles, s, width, lang):
    flows = []
    enrichment = data.get('enrichment') or {}
    identity = enrichment.get('identity') or {}

    # Whole section unavailable when no Access Review snapshot was captured.
    if not identity.get('available'):
        flows.append(Paragraph(s['er_identity_unavailable'], styles['DocBody']))
        return flows

    def yes_no(v):
        return s['er_yes'] if v else s['er_no']

    def mfa_label(v):
        if v == 'yes':
            return s['er_yes']
        if v == 'no':
            return s['er_no']
        return s['er_unknown']

    def activity_label(item):
        la = item.get('lastActivity')
        if la:
            return str(la)[:19]
        if item.get('neverRedeemed'):
            return s['er_never_redeemed']
        return '—'

    # ─── Accounts with Admin Roles (Access Review snapshot only) ───
    # The full admin roster lives in the Users section (always-polled
    # privileged_roles). Here we ONLY add the richer view — last-activity and
    # break-glass tagging — when a real Access Review snapshot was captured.
    # When it wasn't, we skip silently (no misleading "no admins" line, no
    # duplicate of the Users-section table).
    admins = identity.get('admins') or []
    if admins:
        flows.append(Paragraph(f"<b>{esc(s['er_sec_admins'])}</b>", styles['DocSubHeading']))
        rows = []
        for a in admins:
            account = a.get('account') or a.get('upn') or '—'
            if a.get('breakGlass'):
                account = f"{account} ({s['er_breakglass_tag']})"
            roles = ', '.join(a.get('roles') or []) or '—'
            rows.append([
                account,
                roles,  # std_table wraps every cell in a DocTableCell Paragraph;
                        # pass the STRING (a pre-built Paragraph would be re-esc'd
                        # into its repr).
                yes_no(a.get('enabled')),
                mfa_label(a.get('mfa')),
                activity_label(a),
            ])
        t = std_table(
            [s['er_col_account'], s['er_col_roles'], s['er_col_enabled'],
             s['er_col_mfa'], s['er_col_activity']],
            rows, [140, 140, 50, 50, 124], styles
        )
        if t:
            flows.append(t)
            flows.append(Spacer(1, 8))

    # NOTE: the inactive-accounts listing lives in the Users section
    # (build_section_users — entra/sign-in sourced, richer: per-user last sign-in,
    # Licensed column, internal/guest split, "no Entra ID P1" notes). The duplicate
    # Identity-Hygiene inactive subsection was removed (single source of truth) when
    # the shared enrichment switched inactive_users → inactive_members/guests.

    # ─── Break-Glass (Emergency Access) ───
    flows.append(Paragraph(f"<b>{esc(s['er_sec_breakglass'])}</b>", styles['DocSubHeading']))
    bg = enrichment.get('breakGlass') or {}
    if not bg.get('configured'):
        flows.append(Paragraph(s['er_bg_not_configured'], styles['DocBody']))
    else:
        group_name = bg.get('group_name') or bg.get('group_id') or '—'
        flows.append(Paragraph(
            f"<b>{esc(s['er_bg_group_label'])}:</b> {esc(group_name)}",
            styles['DocBody']
        ))
        if not bg.get('members_available'):
            flows.append(Paragraph(s['er_bg_members_unavailable'], styles['DocBody']))
        else:
            members = bg.get('members') or []
            if members:
                names = ', '.join(
                    (m.get('account') or m.get('upn') or '') for m in members
                ) or s['er_none']
            else:
                names = s['er_none']
            flows.append(Paragraph(
                f"<b>{esc(s['er_bg_members_label'])}:</b> {esc(names)}",
                styles['DocBody']
            ))

    return flows


def build_section_app_governance(data, styles, s, width, lang):
    flows = []
    enrichment = data.get('enrichment') or {}
    apps = enrichment.get('apps') or {}

    # Whole section unavailable when the inventory was not captured.
    if not apps.get('available'):
        flows.append(Paragraph(s['er_apps_unavailable'], styles['DocBody']))
        return flows

    def verdict_label(v):
        if v == 'green':
            return s['er_verdict_green']
        if v == 'yellow':
            return s['er_verdict_yellow']
        if v == 'red':
            return s['er_verdict_red']
        return s['er_verdict_none']

    # Each app is rendered as a SINGLE Paragraph — the app name + metadata on the
    # first line, then the full permission list below. A Paragraph is a
    # splittable flowable, so a broadly-permissioned app (e.g. the monitoring app
    # or a Microsoft first-party app with dozens of permissions) simply flows
    # onto the next page instead of producing an over-tall, unsplittable table
    # row that crashes the build. This is why the Configuration Documentation
    # report can list every permission where a fixed table cannot.
    def app_block(meta_html, item):
        items = [str(p) for p in (item.get('permissions') or []) if p]
        perms = ', '.join(items) if items else '—'
        html = (meta_html + '<br/>'
                + '<font size="8" color="#555555">'
                + esc(s['er_col_permissions']) + ': ' + esc(perms) + '</font>')
        return [Paragraph(html, styles['DocBody']), Spacer(1, 6)]

    # ─── Known-Good Applications ───
    flows.append(Paragraph(f"<b>{esc(s['er_sec_known_good'])}</b>", styles['DocSubHeading']))
    known_good = apps.get('knownGood') or []
    if known_good:
        for a in known_good:
            meta = ('<b>' + esc(a.get('displayName') or '—') + '</b>'
                    + ' · ' + esc(a.get('publisher') or '—'))
            flows.extend(app_block(meta, a))
    else:
        flows.append(Paragraph(s['er_all_known_good'], styles['DocBody']))
    flows.append(Spacer(1, 6))

    # ─── Other Applications ───
    flows.append(Paragraph(f"<b>{esc(s['er_sec_other_apps'])}</b>", styles['DocSubHeading']))
    others = apps.get('others') or []
    if others:
        for a in others:
            bits = ['<b>' + esc(a.get('displayName') or '—') + '</b>',
                    esc(a.get('publisher') or '—'),
                    esc(s['er_col_verdict']) + ': ' + esc(verdict_label(a.get('verdict')))]
            if a.get('drift_state') == 'drifted':
                bits.append(esc(s['er_drift_yes']))
            flows.extend(app_block(' · '.join(bits), a))
    else:
        flows.append(Paragraph(s['er_none'], styles['DocBody']))

    return flows


def build_section_alert_policies(data, styles, s, width, project_root, lang):
    flows = []
    policies = data.get('alertPolicies') or []
    if not policies:
        flows.append(Paragraph(s['no_data'], styles['DocBody']))
        return flows

    rows = []
    for p in policies:
        rows.append([
            localize_policy_name(p.get('name', ''), project_root, lang),
            localize_enum(p.get('category', ''), ALERT_CATEGORY_LABELS, lang),
            localize_enum(p.get('severity', ''), ALERT_SEVERITY_LABELS, lang),
            ENABLED_TOGGLE_LABELS.get(lang, ENABLED_TOGGLE_LABELS['en']).get(bool(p.get('enabled')), ''),
        ])
    t = std_table(
        [s['col_policy'], s['col_category'], s['col_severity'], s['col_enabled']],
        rows, [240, 110, 80, 60], styles
    )
    if t:
        flows.append(t)
    return flows


# ═══════════════════════════════════════════════════════════════════
# MAIN ASSEMBLY
# ═══════════════════════════════════════════════════════════════════

def build_pdf(data, output_path):
    styles = create_styles()
    width, height = letter
    story = []

    tenant = data.get('tenant', {}) or {}
    tenant_name = tenant.get('display_name') or 'Unknown Tenant'
    lang = data.get('language', 'en')
    s = get_strings(lang)

    # Footer config
    rc = data.get('reportConfig') or {}
    msp_name = rc.get('mspName') or 'Panoptica365'
    platform_attr = rc.get('platformAttribution', True)
    footer_template = s['footer_confidential_with_platform'] if platform_attr else s['footer_confidential_no_platform']
    footer_text = footer_template.format(msp=msp_name)
    # Cover "Prepared by" line: the logged-in operator's name when supplied,
    # falling back to the MSP name for unattended/scheduled runs.
    prepared_by = rc.get('preparedBy') or msp_name

    # Cover image
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    cover_canonical = os.path.join(project_root, 'public', 'img', 'report-cover.png')
    cover_image_path = cover_canonical if os.path.exists(cover_canonical) else None

    # Optional MSP branding logo (transparent PNG uploaded via Settings →
    # Report Branding). Drawn top-left on the cover when present.
    msp_logo_path = os.path.join(project_root, 'data', 'branding', 'logo.png')
    if not os.path.exists(msp_logo_path):
        msp_logo_path = None

    template = DocPageTemplate(tenant_name, s, footer_text)

    # ─── Tenant Identity card (page 2 — after cover) ───
    story.append(Paragraph(s['tenant_identity'], styles['DocSectionHeading']))
    story.append(section_line(width))
    story.append(Spacer(1, 10))
    identity_rows = [
        [s['tenant_display_name'], tenant_name],
        [s['tenant_azure_id'], tenant.get('azure_tenant_id') or '—'],
        [s['tenant_status'], s['status_enabled'] if tenant.get('enabled') else s['status_disabled']],
        [s['tenant_mode'], localize_enum(tenant.get('mode') or 'managed', TENANT_MODE_LABELS, lang)],
        [s['tenant_consented_at'], (str(tenant.get('consented_at') or ''))[:19] or '—'],
        [s['tenant_last_polled'], (str(tenant.get('last_polled_at') or ''))[:19] or '—'],
        [s['tenant_polling_interval'], f"{tenant.get('polling_interval', '?')} min"],
        [s['tenant_poll_count'], fmt_num(tenant.get('poll_count'))],
    ]
    id_table = Table(
        [[Paragraph(f"<b>{esc(k)}</b>", styles['DocBody']),
          Paragraph(esc(v), styles['DocBody'])] for k, v in identity_rows],
        colWidths=[150, 350]
    )
    id_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 0), (-1, -2), 0.25, HexColor(COLORS['border'])),
    ]))
    story.append(id_table)
    story.append(Spacer(1, 12))

    # Note about previous snapshot if any
    prev = data.get('previous_snapshot')
    if prev and prev.get('generated_at'):
        story.append(Paragraph(
            f"<i>{esc(s['previous_snapshot_note'].format(date=str(prev['generated_at'])[:10]))}</i>",
            styles['DocBody']
        ))
        story.append(Spacer(1, 6))

    # ─── Snapshot Summary (cards) ───
    story.append(PageBreak())
    story.append(Paragraph(s['snapshot_summary'], styles['DocSectionHeading']))
    story.append(section_line(width))
    story.append(Spacer(1, 8))
    story.append(Paragraph(s['snapshot_intro'], styles['DocBody']))
    story.append(Spacer(1, 10))
    cards = build_summary_cards(data, styles, s)
    grid = card_grid(cards, cols=4)
    if grid:
        story.append(grid)
    else:
        story.append(Paragraph(s['no_data'], styles['DocBody']))

    # ─── Detail sections ───
    sections = [
        (s['sec_licensing'], lambda: build_section_licensing(data, styles, s, width, lang)),
        (s['sec_users'], lambda: build_section_users(data, styles, s, width, lang)),
        (s['sec_mfa'], lambda: build_section_mfa(data, styles, s, width, lang)),
        (s['sec_ca'], lambda: build_section_ca(data, styles, s, width, lang)),
        (s['sec_security_settings'], lambda: build_section_security_settings(data, styles, s, width, lang)),
        (s['sec_exemptions'], lambda: build_section_exemptions(data, styles, s, width, project_root, lang)),
        (s['sec_devices'], lambda: build_section_devices(data, styles, s, width, lang)),
        (s['sec_domains'], lambda: build_section_domains(data, styles, s, width, lang)),
        (s['email_auth_title'], lambda: build_section_email_auth(data, styles, s, width, project_root, lang)),
        (s['sec_sharepoint'], lambda: build_section_sharepoint(data, styles, s, width, lang)),
        (s['sec_exchange'], lambda: build_section_exchange(data, styles, s, width, lang)),
        (s['sec_inbox_rules'], lambda: build_section_inbox_rules(data, styles, s, width, lang)),
        (s['sec_teams'], lambda: build_section_teams(data, styles, s, width, lang)),
        (s['sec_apps'], lambda: build_section_apps(data, styles, s, width, lang)),
        (s['er_sec_identity'], lambda: build_section_identity(data, styles, s, width, lang)),
        (s['er_sec_app_gov'], lambda: build_section_app_governance(data, styles, s, width, lang)),
        (s['sec_alert_policies'], lambda: build_section_alert_policies(data, styles, s, width, project_root, lang)),
        (s['sec_recent_changes'], lambda: build_section_recent_changes(data, styles, s, width, lang)),
    ]

    for title, builder in sections:
        story.append(PageBreak())
        story.append(section_heading(title, styles, width))
        try:
            section_flows = builder()
        except Exception as e:
            section_flows = [Paragraph(f"<i>Section build error: {esc(str(e))}</i>", styles['DocBody'])]
        story.extend(section_flows)

    # ─── Document setup + cover page ───
    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        leftMargin=54, rightMargin=54, topMargin=60, bottomMargin=54,
        title=f'{tenant_name} — {s["report_title"]}',
        author='Panoptica365',
    )

    def on_first_page(canvas_obj, doc):
        canvas_obj.saveState()
        w, h = letter
        if cover_image_path and os.path.exists(cover_image_path):
            canvas_obj.drawImage(cover_image_path, 0, 0, width=w, height=h,
                                 preserveAspectRatio=True, anchor='c')

        # Shared cover layout (matches the Security Posture report): optional MSP
        # logo top-left in the whitest area, then a left-aligned title stack.
        left_x = 0.6 * inch
        logo_top = h * 0.70
        logo_max_w = 2.6 * inch
        logo_max_h = 1.15 * inch

        if msp_logo_path:
            try:
                ir = ImageReader(msp_logo_path)
                iw, ih = ir.getSize()
                scale = min(logo_max_w / iw, logo_max_h / ih)
                dw, dh = iw * scale, ih * scale
                canvas_obj.drawImage(ir, left_x, logo_top - dh, width=dw, height=dh,
                                     mask='auto')
                cursor_y = logo_top - dh - 30
            except Exception:
                cursor_y = logo_top
        else:
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

        # Optional subtitle (skipped when empty, e.g. fr)
        if s.get('cover_subtitle'):
            cursor_y -= 22
            canvas_obj.setFont('Helvetica', 12)
            canvas_obj.setFillColor(HexColor('#4A5568'))
            canvas_obj.drawString(left_x, cursor_y, s['cover_subtitle'])

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

        # Prepared by (operator, falling back to MSP)
        cursor_y -= 22
        canvas_obj.setFont('Helvetica-Oblique', 10)
        canvas_obj.setFillColor(HexColor('#666666'))
        canvas_obj.drawString(left_x, cursor_y, s['cover_prepared_by'].format(msp=prepared_by))
        canvas_obj.restoreState()

    def on_later_pages(canvas_obj, doc):
        template.on_page(canvas_obj, doc)

    cover_story = [Spacer(1, 1), PageBreak()] + story
    doc.build(cover_story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
    print(f'Documentation PDF generated: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python3 generate-documentation-report.py <input.json> <output.pdf>')
        sys.exit(1)
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    build_pdf(data, sys.argv[2])
