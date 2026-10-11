from fastapi import HTTPException
from fastapi.routing import APIRoute
from python_multipart.multipart import parse_options_header
from starlette.formparsers import MultiPartException, MultiPartParser

from .engine import MAX_UPLOAD_BYTES
from .rules import MAX_REFERENCES


class BoundedMultipartParser(MultiPartParser):
    spool_max_size = MAX_UPLOAD_BYTES + 1

    def on_part_begin(self):
        super().on_part_begin()
        self._part_bytes = 0
        self._header_bytes = 0

    def on_part_data(self, data, start, end):
        self._part_bytes += end - start
        if self._current_part.file is not None and self._part_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"Cada imagem deve ter no máximo {MAX_UPLOAD_BYTES/(1024*1024):g} MB.")
        super().on_part_data(data, start, end)

    def _check_header(self, size):
        self._header_bytes += size
        if self._header_bytes > 8192:
            raise HTTPException(413, "Os cabeçalhos do arquivo excedem o tamanho permitido.")

    def on_header_field(self, data, start, end):
        self._check_header(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self._check_header(end - start)
        super().on_header_value(data, start, end)

    def on_end(self):
        self._finished = True

    async def parse(self):
        self._finished = False
        try:
            form = await super().parse()
            if not self._finished:
                raise HTTPException(400, "O envio da imagem está incompleto. Tente novamente.")
            return form
        except BaseException:
            for file in self._files_to_close_on_error:
                file.close()
            raise


class BoundedUploadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded_handler(request):
            if request.method == "POST":
                content_type, options = parse_options_header(request.headers.get("content-type", ""))
                if content_type != b"multipart/form-data":
                    raise HTTPException(422, "Envie as imagens em um formulário multipart.")
                if content_type == b"multipart/form-data":
                    boundary = options.get(b"boundary", b"")
                    if not boundary or len(boundary) > 200:
                        raise HTTPException(400, "O formato do envio da imagem é inválido.")
                    parser = BoundedMultipartParser(
                        request.headers,
                        request.stream(),
                        max_files=MAX_REFERENCES if request.url.path in {"/api/dev/profiles","/api/dev/enrollment-check"} else 1,
                        max_fields=3,
                        max_part_size=1024,
                    )
                    try:
                        request._form = await parser.parse()
                    except MultiPartException:
                        raise HTTPException(422, "O envio excede a quantidade ou o tamanho permitido de campos e imagens.") from None
            return await handler(request)

        return bounded_handler
