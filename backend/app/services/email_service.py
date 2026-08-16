import os
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

    def send_invitation_email(
        self,
        to_email: str,
        invite_token: str,
        inviter_name: str,
        workspace_name: Optional[str] = None,
        is_admin_invite: bool = False
    ) -> bool:
        """
        Send an invitation email using AWS SES if configured, otherwise log the invite link for testing.
        """
        invite_url = f"{self.app_url}?invite_token={invite_token}"
        
        target_description = f"'{workspace_name}' 워크스페이스" if workspace_name else "Project Run : Finder"
        role_description = "관리자 승인이 완료된 정식 멤버" if is_admin_invite else "팀 멤버"

        subject = f"[Project Run : Finder] {inviter_name}님이 {target_description}에 초대하셨습니다"
        
        html_body = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {{ font-family: 'Segoe UI', AppleSDGothicNeo, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 20px; }}
            .card {{ max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }}
            .header {{ font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 16px; }}
            .content {{ font-size: 15px; color: #334155; line-height: 1.6; margin-bottom: 24px; }}
            .btn {{ display: inline-block; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 15px; }}
            .footer {{ font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }}
            .link-box {{ background: #f1f5f9; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 12px; color: #2563eb; }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">Project Run : Finder 초대장</div>
            <div class="content">
              안녕하세요,<br><br>
              <strong>{inviter_name}</strong>님이 회원님을 <strong>{target_description}</strong>의 {role_description}로 초대하셨습니다.<br>
              초대 링크는 발송일로부터 <strong>7일간 유효</strong>합니다.
            </div>
            <div style="text-align: center; margin: 28px 0;">
              <a href="{invite_url}" class="btn" target="_blank">초대 수락 및 참여하기</a>
            </div>
            <div class="footer">
              버튼이 클릭되지 않는 경우 아래 링크를 브라우저에 직접 붙여넣으세요:
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
