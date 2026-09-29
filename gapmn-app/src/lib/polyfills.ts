// src/lib/polyfills.ts
// Recursos que o pdf.js 5 usa e que navegadores anteriores a 2024 não têm.
// O build legacy do pdf.js já cobre Promise.withResolvers, mas NÃO cobre a
// iteração assíncrona de ReadableStream (`for await (x of stream)`, Chrome 124+),
// usada em page.getTextContent(). Sem isto a leitura de qualquer PDF falha com
// "r is not iterable".

type LeitorIteravel = AsyncIterableIterator<unknown> & { return(value?: unknown): Promise<IteratorResult<unknown>> };

if (typeof ReadableStream !== "undefined" && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  const values = function (this: ReadableStream, opcoes?: { preventCancel?: boolean }): LeitorIteravel {
    const reader = this.getReader();
    const preventCancel = !!opcoes?.preventCancel;
    return {
      async next() {
        const r = await reader.read();
        if (r.done) reader.releaseLock();
        return r as IteratorResult<unknown>;
      },
      async return(value?: unknown) {
        if (!preventCancel) {
          const cancelado = reader.cancel(value);
          reader.releaseLock();
          await cancelado;
        } else {
          reader.releaseLock();
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  Object.defineProperty(ReadableStream.prototype, "values", { value: values, writable: true, configurable: true });
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

export {};
