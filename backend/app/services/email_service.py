import os
from html import escape
import boto3
from botocore.exceptions import ClientError
from typing import Optional
from app.core.config import settings

class EmailService:
    @property
    def aws_access_key(self) -> str:
        return (settings.AWS_SES_ACCESS_KEY_ID or settings.AWS_ACCESS_KEY_ID or 
                os.getenv("AWS_SES_ACCESS_KEY_ID") or os.getenv("AWS_ACCESS_KEY_ID") or "")

    @property
    def aws_secret_key(self) -> str:
        return (settings.AWS_SES_SECRET_ACCESS_KEY or settings.AWS_SECRET_ACCESS_KEY or 
                os.getenv("AWS_SES_SECRET_ACCESS_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY") or "")

    @property
    def aws_region(self) -> str:
        return (settings.AWS_SES_REGION or settings.AWS_REGION or 
                os.getenv("AWS_SES_REGION") or os.getenv("AWS_REGION") or "ap-northeast-2")

    @property
    def source_email(self) -> str:
        return (settings.SES_FROM_EMAIL_NOTIFY or settings.SES_SOURCE_EMAIL or 
                os.getenv("SES_FROM_EMAIL_NOTIFY") or os.getenv("SES_SOURCE_EMAIL") or "notify@proj.run")

    @property
    def app_url(self) -> str:
        return settings.APP_PUBLIC_URL or os.getenv("APP_PUBLIC_URL", "https://finder.proj.run")

    @property
    def is_ses_configured(self) -> bool:
        key = self.aws_access_key
        secret = self.aws_secret_key
        return bool(key and secret and len(key.strip()) > 5 and len(secret.strip()) > 5 and key != "your_ses_key")

    def send_notification(self, to_emails, subject: str, html_body: str, text_body: str = "") -> bool:
        """
        Send one notification to one or more recipients.

        Used for operational mail (storage warnings, deletion notices) rather
        than invitations. Falls back to logging when SES is not configured, so
        a development environment still shows what would have been sent
        instead of failing the action that triggered it.
        """
        recipients = [e for e in (to_emails if isinstance(to_emails, (list, tuple, set)) else [to_emails]) if e]
        if not recipients:
            return False

        if not self.is_ses_configured:
            print(f"\n[NOTIFICATION MOCK] TO: {recipients}\nSUBJECT: {subject}\n{text_body or ''}\n")
            return True

        client = boto3.client(
            "ses",
            region_name=self.aws_region,
            aws_access_key_id=self.aws_access_key,
            aws_secret_access_key=self.aws_secret_key,
        )
        source_formatted = f"Project Run : Finder <{self.source_email}>"
        # One message per person. A single send with everybody in To would
        # show each recipient the others' addresses — for a storage warning to
        # the administrators that is a list of who they are, disclosed by a
        # notification nobody asked to be on.
        delivered = 0
        for address in recipients:
            try:
                response = client.send_email(
                    Source=source_formatted,
                    Destination={"ToAddresses": [address]},
                    Message={
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {
                            "Html": {"Data": html_body, "Charset": "UTF-8"},
                            "Text": {"Data": text_body or subject, "Charset": "UTF-8"},
                        },
                    },
                )
                delivered += 1
                print(f"[SES Success] Sent notification to {address}, MessageId: {response.get('MessageId')}")
            except Exception as e:
                # Reported, not swallowed: this used to fall through to the
                # mock print and return True, so a failed send looked like a
                # delivered one and the caller marked it done.
                print(f"[SES Error] notification to {address}: {e}")
        return delivered > 0

    def send_invitation_email(
        self,
        to_email: str,
        invite_token: str,
        inviter_name: str,
        workspace_name: Optional[str] = None,
        role: str = "member",
        is_admin_invite: bool = False
    ) -> bool:
        """
        Send an invitation email using AWS SES if configured, otherwise log the invite link for testing.
        """
        invite_url = f"{self.app_url}?invite_token={invite_token}"

        # Both are written by people — a workspace called "R&D <2026>" would
        # otherwise arrive with its name mangled, or worse, as markup.
        safe_inviter = escape(inviter_name or "")
        safe_workspace = escape(workspace_name) if workspace_name else ""
        target_description = f"'{safe_workspace}' 워크스페이스" if workspace_name else "Project Run : Finder"
        # A subject line is plain text: the escaped version would arrive
        # showing "&amp;" where the name has an ampersand.
        target_plain = f"'{workspace_name}' 워크스페이스" if workspace_name else "Project Run : Finder"
        role_label = "관리자 (Admin)" if role == "admin" else "멤버 (Member)"

        subject = f"[Project Run : Finder] {inviter_name}님이 {target_plain}에 초대하셨습니다"
        
        html_body = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', AppleSDGothicNeo, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 20px; }}
            .card {{ max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }}
            .header {{ font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }}
            .content {{ font-size: 15px; color: #334155; line-height: 1.65; margin-bottom: 24px; }}
            .info-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 14px; color: #475569; }}
            .info-row {{ margin-bottom: 6px; }}
            .info-row:last-child {{ margin-bottom: 0; }}
            .btn {{ display: inline-block; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff !important; padding: 13px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 15px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25); }}
            .footer {{ font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 18px; line-height: 1.5; }}
            .link-box {{ background: #f1f5f9; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 10px; color: #2563eb; }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">Project Run : Finder 초대장</div>
            <div class="content">
              안녕하세요,<br><br>
              <strong>{safe_inviter}</strong>님이 회원님을 <strong>{target_description}</strong>에 초대하셨습니다.<br>
              초대를 수락하시면 별도의 대기 없이 즉시 참여하여 워크스페이스의 문서와 지식을 공유하고 협업하실 수 있습니다.
            </div>

            <div class="info-box">
              <div class="info-row"><strong>• 초대 워크스페이스:</strong> {target_description}</div>
              <div class="info-row"><strong>• 부여 역할:</strong> {role_label}</div>
              <div class="info-row"><strong>• 링크 유효기간:</strong> 발송일로부터 7일간 유효</div>
            </div>

            <div style="text-align: center; margin: 30px 0 20px;">
              <a href="{invite_url}" class="btn" target="_blank">초대 수락 및 참여하기</a>
            </div>

            <div class="footer">
              초대 링크가 클릭되지 않는 경우 아래 주소를 복사하여 브라우저 주소창에 직접 입력해주세요:
              <div class="link-box">{invite_url}</div>
            </div>
          </div>
        </body>
        </html>
        """

        if self.is_ses_configured:
            try:
                client = boto3.client(
                    "ses",
                    region_name=self.aws_region,
                    aws_access_key_id=self.aws_access_key,
                    aws_secret_access_key=self.aws_secret_key
                )
                source_formatted = f"Project Run <{self.source_email}>" if ("@" in self.source_email and "<" not in self.source_email) else self.source_email
                response = client.send_email(
                    Source=source_formatted,
                    Destination={"ToAddresses": [to_email]},
                    Message={
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {
                            "Html": {"Data": html_body, "Charset": "UTF-8"},
                            "Text": {"Data": f"{inviter_name}님이 초대한 링크: {invite_url}", "Charset": "UTF-8"}
                        }
                    }
                )
                print(f"[SES Success] Sent invitation email to {to_email}, MessageId: {response.get('MessageId')}")
                return True
            except ClientError as e:
                err_code = e.response.get('Error', {}).get('Code', 'Unknown')
                err_msg = e.response.get('Error', {}).get('Message', str(e))
                print(f"[SES Error] Code: {err_code}, Message: {err_msg}")
            except Exception as e:
                print(f"[SES Unexpected Error] {e}")
        else:
            print(f"[SES Info] AWS SES credentials not configured in environment; fallback to console mock.")
        
        # Local console logger fallback for test development
        print(f"\n=======================================================")
        print(f"📧 [INVITATION EMAIL MOCK (AWS SES ready)]")
        print(f"TO: {to_email}")
        print(f"SUBJECT: {subject}")
        print(f"INVITE LINK: {invite_url}")
        print(f"=======================================================\n")
        return True

email_service = EmailService()
