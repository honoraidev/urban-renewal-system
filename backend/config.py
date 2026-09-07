from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DB_HOST: str = "mariadb"
    DB_PORT: int = 3306
    DB_NAME: str = "urban_renewal_db"
    DB_USER: str = "urban_renewal_app"
    DB_PASSWORD: str = ""
    # If set, connects via this Unix socket instead of DB_HOST/DB_PORT (TCP). Used on
    # the NAS where the target MariaDB's TCP port is occupied by an unrelated container,
    # so the app talks to the native MariaDB package directly through its socket file.
    DB_SOCKET: str = ""

    JWT_SECRET: str = "dev-only-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    UPLOAD_DIR: str = "/app/uploads"
    CORS_ORIGINS: str = "http://localhost:8080"
    ALERT_UNCONTACTED_DAYS: int = 14

    ADMIN_INITIAL_PASSWORD: str = "Admin@2026"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # 發票拍照辨識可選用 Google Gemini(有免費額度)。設了金鑰就優先用 Gemini,
    # 否則退回本機 PaddleOCR + 規則解析。金鑰申請:https://aistudio.google.com/apikey
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.6-flash"
    # 發票辨識 ③ 校正是否改用 Gemini(預設 False = 純規則)。
    INVOICE_USE_GEMINI: bool = False
    # 謄本結構化擷取用哪個 LLM:"openai"(預設,gpt-4o*)、"gemini"(GEMINI_API_KEY)、
    # "qwen"(阿里雲 DashScope Qwen-VL,DASHSCOPE_API_KEY)或 "bedrock"(Amazon Bedrock,
    # AWS 憑證)。只影響 OCR 文字之後的「填 JSON」那一步,PaddleOCR/RapidOCR 不受影響。
    OCR_LLM_PROVIDER: str = "openai"

    # 阿里雲 DashScope(OCR_LLM_PROVIDER=qwen 時)。國際站 base URL 如下;中國站改成
    # https://dashscope.aliyuncs.com/compatible-mode/v1 。qwen-vl-max 準度高、qwen-vl-plus 便宜。
    DASHSCOPE_API_KEY: str = ""
    DASHSCOPE_MODEL: str = "qwen-vl-max"
    DASHSCOPE_BASE_URL: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

    # Amazon Bedrock(OCR_LLM_PROVIDER=bedrock 時)。AWS_BEARER_TOKEN_BEDROCK 從環境變數
    # 讀(Bedrock API 金鑰,Authorization: Bearer)。
    AWS_BEARER_TOKEN_BEDROCK: str = ""
    BEDROCK_REGION: str = "us-east-1"
    BEDROCK_MODEL: str = "us.anthropic.claude-sonnet-4-6"
    # 是否允許發票辨識用「本機 OCR」(這個 Docker image 裝的是 RapidOCR / ONNX CPU,
    # 輕量、不會 OOM)。預設 True。設 False 則沒 QR 就直接回錯、完全不跑 OCR。
    INVOICE_ALLOW_LOCAL_OCR: bool = True

    # 遠端 OCR 服務(ocr_service.py,跑在有 GPU 的機器上)。設了 URL 之後,NAS 上的
    # 發票辨識會把影像轉發過去、完全不在本機跑 OCR。空字串 = 不用遠端。
    # 例:OCR_REMOTE_URL=http://gpu-box.tailXXXX.ts.net:8090
    OCR_REMOTE_URL: str = ""
    OCR_REMOTE_SECRET: str = ""

    # Scanned-deed OCR tuning (no effect on text-layer 電子謄本, which skip OCR entirely).
    OCR_PAGES_PER_CHUNK: int = 4
    OCR_CHUNK_OVERLAP: int = 2
    OCR_CHUNK_CONCURRENCY: int = 3
    OCR_SMART_RESCAN_MAX_PAGES: int = 6
    OCR_MISSING_AREA_RESCAN_MAX_CHUNKS: int = 3

    @property
    def database_url(self) -> str:
        # DB_USER/DB_PASSWORD must be percent-encoded before going into the connection
        # URL - otherwise special characters (e.g. a literal "@" in the password) get
        # misinterpreted as URL syntax (like the user:pass/host separator) and silently
        # corrupt the parsed host/credentials instead of raising a clear error.
        user = quote_plus(self.DB_USER)
        password = quote_plus(self.DB_PASSWORD)
        if self.DB_SOCKET:
            return f"mysql+pymysql://{user}:{password}@/{self.DB_NAME}?unix_socket={self.DB_SOCKET}&charset=utf8mb4"
        return f"mysql+pymysql://{user}:{password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
