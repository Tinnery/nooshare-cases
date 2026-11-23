import logging

import typer

from nooshare_cases.config import LOG_LEVEL

logging.basicConfig(level=LOG_LEVEL, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

app = typer.Typer(help="nooshare-cases command line application")

@app.command()
def run(name: str = "system") -> None:
    logger.info("Application started")
    print(f"Hello {name}")
