package lisp

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"
)

func Tokenize(input string) []string {
	var tokens []string
	var token strings.Builder
	inString := false

	for i, char := range input {
		_ = i
		switch {
		case char == '"':
			if inString {
				token.WriteRune(char)
				tokens = append(tokens, token.String())
				token.Reset()
				inString = false
			} else {
				if token.Len() > 0 {
					tokens = append(tokens, token.String())
					token.Reset()
				}
				token.WriteRune(char)
				inString = true
			}
		case inString:
			token.WriteRune(char)
		case unicode.IsSpace(char):
			if token.Len() > 0 {
				tokens = append(tokens, token.String())
				token.Reset()
			}
		case char == '(' || char == ')':
			if token.Len() > 0 {
				tokens = append(tokens, token.String())
				token.Reset()
			}

			tokens = append(tokens, string(char))
		case char == '\'':
			if token.Len() > 0 {
				tokens = append(tokens, token.String())
				token.Reset()
			}

			tokens = append(tokens, "'")
		default:
			token.WriteRune(char)
		}
	}

	if token.Len() > 0 {
		tokens = append(tokens, token.String())
	}

	return tokens
}

func Parse(tokens []string) (*ASTNode, []string, error) {
	if len(tokens) == 0 {
		return nil, tokens, fmt.Errorf("empty input")
	}

	token := tokens[0]
	tokens = tokens[1:]

	switch token {
	case "(":
		var children []*ASTNode

		for len(tokens) > 0 && tokens[0] != ")" {
			var child *ASTNode
			var err error

			child, tokens, err = Parse(tokens)
			if err != nil {
				return &ASTNode{
					Type:  NODE_ERR,
					Value: err.Error(),
				}, tokens, err
			}

			children = append(children, child)
		}

		if len(tokens) == 0 {
			return &ASTNode{
				Type:  NODE_ERR,
				Value: "unexpected EOF",
			}, tokens, fmt.Errorf("unexpected EOF")
		}

		tokens = tokens[1:]

		return &ASTNode{
			Type:     NODE_LIST,
			Children: children,
		}, tokens, nil
	case ")":
		return &ASTNode{
			Type:  NODE_ERR,
			Value: "unexpected ')'",
		}, tokens, fmt.Errorf("unexpected ')'")
	case "'":
		quotedNode := &ASTNode{
			Type: NODE_LIST,
		}

		quoteSym := &ASTNode{
			Type:  NODE_SYM,
			Value: "quote",
		}

		quotedNode.Children = append(quotedNode.Children, quoteSym)

		quotedExpr, remainingTokens, err := Parse(tokens)
		if err != nil {
			return &ASTNode{Value: err.Error(), Type: NODE_ERR}, tokens, err
		}

		quotedNode.Children = append(quotedNode.Children, quotedExpr)

		return quotedNode, remainingTokens, nil
	default:
		node, err := parseAtom(token)
		return node, tokens, err
	}
}

func parseAtom(token string) (*ASTNode, error) {
	if i, err := strconv.Atoi(token); err == nil {
		return &ASTNode{
			Type:  NODE_INT,
			Value: i,
		}, nil
	}

	if f, err := strconv.ParseFloat(token, 64); err == nil {
		return &ASTNode{
			Type:  NODE_FLOAT,
			Value: f,
		}, nil
	}

	if strings.HasPrefix(token, "\"") && strings.HasSuffix(token, "\"") {
		return &ASTNode{Value: token[1 : len(token)-1], Type: NODE_STR}, nil
	}

	switch token {
	case SYM_TRUE:
		return &ASTNode{
			Type:  NODE_BOOL,
			Value: SYM_TRUE_VAL,
		}, nil
	case SYM_FALSE:
		return &ASTNode{
			Type:  NODE_BOOL,
			Value: SYM_FALSE_VAL,
		}, nil
	case SYM_NIL:
		return &ASTNode{
			Type:  NODE_BOOL,
			Value: SYM_NIL_VAL,
		}, nil
	default:
		return &ASTNode{
			Type:  NODE_SYM,
			Value: token,
		}, nil
	}
}

func FmtAST(w io.Writer, node *ASTNode, indent string) {
	if node.Type == NODE_LIST || node.Type == NODE_FUNC {
		fmt.Fprintf(w, "%s(\n", indent)

		for _, child := range node.Children {
			FmtAST(w, child, indent+"  ")
		}

		fmt.Fprintf(w, "%s)\n", indent)
	} else if node.Type == NODE_PRIM {
		s, _ := node.Children[0].Str()
		fmt.Fprintf(w, "%s%s: %v\n", indent, s, node.Value)

	} else if node.Type != NODE_BOOL {
		fmt.Fprintf(w, "%s%s: %v\n", indent, SYM_TABLE[node.Type], node.Value)
	} else {
		v, _ := node.Bool()
		fmt.Fprintf(w, "%s%s: %v\n", indent, SYM_TABLE[node.Type], BOOL_TABLE[v])
	}
}
