"""
Envío de emails con smtplib + STARTTLS (spec deploy §4d).

SOLO lo usa la recuperación de contraseña (los tests mockean este módulo,
nunca envían de verdad). Sin SMTP_HOST configurado NO envía nada (log y
return): en dev esto permite correr el flujo completo sin armar SMTP.

Recomendado: Gmail con app-password (cuenta con 2FA, remitente = tu Gmail).
Alternativa: Brevo free (300/día) cambiando SMTP_HOST — el código es el mismo.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings


def enviar_email(asunto: str, cuerpo_html: str, destinatarios: list[str]) -> None:
    """Envía un email (HTML simple) a las direcciones dadas. Best effort:
    si SMTP no está configurado, loguea y corta; si el servidor SMTP falla,
    propaga la excepción (el router decidió si el flujo la tolera)."""
    if not settings.smtp_host:
        print(f"[email] SMTP sin configurar — NO se envió: '{asunto}'")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = asunto
    msg["From"] = settings.email_from or settings.smtp_user
    msg["To"] = ", ".join(destinatarios)
    msg.attach(MIMEText(cuerpo_html, "html", "utf-8"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_user, settings.smtp_pass)
        smtp.sendmail(msg["From"], destinatarios, msg.as_string())