import {
  SurpcFile,
  StructType,
  Field,
  Reference,
  VariableDeclaration,
  RPC,
  Channel,
  ImportStatement,
  Statement,
} from "./ast";
import { alphanum, char } from "parser-ts/lib/char";
import {
  string,
  spaces1,
  spaces,
  many1 as stringMany1,
  doubleQuotedString,
} from "parser-ts/lib/string";
import {
  seq,
  sepBy1,
  map,
  maybe,
  Parser,
  apFirst,
  many,
  fail,
  many1,
  sat,
  either,
  eof,
} from "parser-ts/lib/Parser";
import { getMonoid } from "fp-ts/lib/Array";
import { NonEmptyArray } from "fp-ts/lib/NonEmptyArray";
import { stream } from "parser-ts/lib/Stream";
import { apSecond } from "fp-ts/lib/Option";

const spaceRe = /^\s$/;

function isNonNewlineSpace(char: string): boolean {
  return char !== "\n" && spaceRe.test(char);
}
const nonNewlineSpace = many(sat(isNonNewlineSpace));
const nonNewlineSpace1 = many1(sat(isNonNewlineSpace));

const allowSpaceLeft = <T>(parser: Parser<string, T>) =>
  seq(nonNewlineSpace, () => parser);
const allowSpaceRight = <T>(parser: Parser<string, T>) =>
  apFirst(nonNewlineSpace)(parser);
const allowSpaceAround = <T>(parser: Parser<string, T>) =>
  allowSpaceLeft(allowSpaceRight(parser));

const allowNewlineSpaceRight = <T>(parser: Parser<string, T>) =>
  apFirst(spaces)(parser);

export type BasicToken<T> = {
  token: T;
};

const parserForBasicToken = <T extends string>(
  tokenName: T,
  parseStr: string = tokenName
) => {
  return map(() => {
    const token: BasicToken<T> = { token: tokenName };
    return token;
  })(string(parseStr));
};

/* Import statements */
export type ImportToken = BasicToken<"import">;
// Allow newlines after this!
const importTokenParser = apFirst(spaces1)(
  parserForBasicToken<"import">("import")
);

// Allow lots of newlines around this!
export type FromToken = BasicToken<"from">;
const fromTokenParser = apFirst(spaces1)(
  seq(spaces1, () => parserForBasicToken<"from">("from"))
);

export type QuotedStringToken = {
  token: "quotedString";
  contents: string;
};
const quotedStringTokenParser = map(
  (str: string): QuotedStringToken => ({
    token: "quotedString",
    contents: str,
  })
)(doubleQuotedString);

/* Keyword declaration tokens */
export type StructToken = BasicToken<"struct">;
const structTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"struct">("struct")
);
export type OneOfToken = BasicToken<"oneof">;
const oneofTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"oneof">("oneof")
);
export type ServiceToken = BasicToken<"service">;
const serviceTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"service">("service")
);
export type RPCToken = BasicToken<"rpc">;
const rpcTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"rpc">("rpc")
);
export type ChannelToken = BasicToken<"channel">;
const channelTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"channel">("channel")
);

/* Joiner Tokens */
export type ColonToken = BasicToken<"colon">;
const colonTokenParser = allowSpaceAround(
  parserForBasicToken<"colon">("colon", ":")
);

// Right now, we're only gonna deal with single line comments
// because they're good enough, and multiline comments sound frustrating
// to try to tokenize at this point
export type NewLineToken = BasicToken<"newline">;
const newlineTokenParser: Parser<string, NewLineToken> = map(
  (): NewLineToken => ({
    token: "newline",
  })
)(many1(allowSpaceLeft(char("\n"))));

// Right now this means 2 spaces or a tab but it really shouldn't
export type IndentToken = BasicToken<"indent">;
const indentParser = map((): IndentToken => ({ token: "indent" }))(
  either(string("  "), () => char("\t"))
);

export type OptionalToken = BasicToken<"optional">;
const optionalTokenParser = apFirst(nonNewlineSpace1)(
  parserForBasicToken<"optional">("optional")
);

export type CommaToken = BasicToken<"comma">;
const commaTokenParser = allowNewlineSpaceRight(
  allowSpaceLeft(parserForBasicToken<"comma">("comma", ","))
);
export type OpenBracketToken = BasicToken<"openbracket">;
const openBracketTokenParser = allowNewlineSpaceRight(
  allowSpaceLeft(parserForBasicToken<"openbracket">("openbracket", "<"))
);
export type CloseBracketToken = BasicToken<"closebracket">;
const closeBracketTokenParser = allowSpaceAround(
  parserForBasicToken<"closebracket">("closebracket", ">")
);

// For fields
export type NameToken = {
  token: "name";
  name: string;
};
export const nameTokenParser: Parser<string, NameToken> = map(
  (name: string): NameToken => ({
    token: "name",
    name: name,
  })
)(stringMany1(alphanum));

export type Token =
  | ImportToken
  | FromToken
  | QuotedStringToken
  | StructToken
  | OneOfToken
  | ServiceToken
  | RPCToken
  | ChannelToken
  | OptionalToken
  | ColonToken
  | NewLineToken
  | IndentToken
  | CommaToken
  | OpenBracketToken
  | CloseBracketToken
  | NameToken;

const anyOf = <S, T>(parsers: Array<Parser<S, T>>) => {
  return parsers.reduceRight((acc, cur) => either(cur, () => acc), fail());
};

export const tokenize: Parser<string, Token[]> = seq(spaces, () =>
  apFirst(seq(spaces, () => eof<string>()))(
    many(
      anyOf<string, Token>([
        // alphanumeric keywords
        importTokenParser,
        fromTokenParser,
        structTokenParser,
        oneofTokenParser,
        serviceTokenParser,
        rpcTokenParser,
        channelTokenParser,
        optionalTokenParser,

        // non-alphanumeric
        quotedStringTokenParser,
        colonTokenParser,
        commaTokenParser,
        openBracketTokenParser,
        closeBracketTokenParser,

        // alphanumeric, defaults
        newlineTokenParser,
        indentParser,
        nameTokenParser,
      ])
    )
  )
);