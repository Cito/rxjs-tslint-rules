/**
 * @license Use of this source code is governed by an MIT-style license that
 * can be found in the LICENSE file at https://github.com/cartant/rxjs-tslint-rules
 */
/*tslint:disable:no-use-before-declare*/

import * as Lint from "tslint";
import * as ts from "typescript";
import * as tsutils from "tsutils";
import * as decamelize from "decamelize";

import { couldBeType, isReferenceType } from "../support/util";

export class Rule extends Lint.Rules.TypedRule {

    public static metadata: Lint.IRuleMetadata = {
        description: "Disallows unsafe first/take usage in effects and epics.",
        options: {
            properties: {
                observable: {
                    oneOf: [
                        { type: "string" },
                        { type: "array", items: { type: "string" } }
                    ]
                }
            },
            type: "object"
        },
        optionsDescription: Lint.Utils.dedent`
            An optional object with an optional \`observable\` property.
            The property can be specifed as a regular expression string or as an array of words and is used to identify the action observables from which effects and epics are composed.`,
        requiresTypeInfo: true,
        ruleName: "rxjs-no-unsafe-first",
        type: "functionality",
        typescriptOnly: true
    };

    public static FAILURE_STRING = "Unsafe first usage in effects and epics is forbidden";

    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
        return this.applyWithWalker(new Walker(sourceFile, this.getOptions(), program));
    }
}

export class Walker extends Lint.ProgramAwareRuleWalker {

    public static METHODS_REGEXP = /(ofType|pipe)/;
    public static DEFAULT_OBSERVABLE = "action(s|\\$)?";

    private observableRegExp: RegExp;

    public static createRegExp(value: any): RegExp | null {

        if (!value || !value.length) {
            return null;
        }
        const flags = "i";
        if (typeof value === "string") {
            return new RegExp(value, flags);
        }
        const words = value as string[];
        const joined = words.map(word => `(\\b|_)${word}(\\b|_)`).join("|");
        return new RegExp(`(${joined})`, flags);
    }

    constructor(sourceFile: ts.SourceFile, rawOptions: Lint.IOptions, program: ts.Program) {

        super(sourceFile, rawOptions, program);

        const [options] = this.getOptions();
        if (options && (options.allow || options.disallow)) {
            this.observableRegExp = new RegExp(options.observable || Walker.DEFAULT_OBSERVABLE, "i");
        } else {
            this.observableRegExp = new RegExp(Walker.DEFAULT_OBSERVABLE, "i");
        }
    }

    protected visitCallExpression(node: ts.CallExpression): void {

        const { expression: propertyAccessExpression } = node;
        if (tsutils.isPropertyAccessExpression(propertyAccessExpression)) {

            const { expression: observableExpression } = propertyAccessExpression;
            let observableIdentifier: ts.Identifier | undefined = undefined;
            if (tsutils.isIdentifier(observableExpression)) {
                observableIdentifier = observableExpression;
            } else if (tsutils.isPropertyAccessExpression(observableExpression)) {
                observableIdentifier = observableExpression.name;
            }

            if (observableIdentifier && this.observableRegExp.test(observableIdentifier.getText())) {

                const propertyName = propertyAccessExpression.name.getText();
                const identifierText = observableIdentifier.getText();
                const typeChecker = this.getTypeChecker();
                const type = typeChecker.getTypeAtLocation(observableExpression);

                if (isReferenceType(type) &&
                    Walker.METHODS_REGEXP.test(propertyName) &&
                    couldBeType(type.target, "Observable")) {

                    switch (propertyName) {
                    case "ofType":
                        this.walkPatchedTypes(node);
                        break;
                    case "pipe":
                        this.walkPipedTypes(node);
                        break;
                    default:
                        break;
                    }
                }
            }
        }

        super.visitCallExpression(node);
    }

    private walkPatchedOperators(node: ts.Node): void {

        let name: ts.Identifier | undefined = undefined;
        for (let parent = node.parent; parent; parent = parent.parent) {
            if (tsutils.isCallExpression(parent)) {
                if (name) {
                    switch (name.getText()) {
                    case "first":
                        this.addFailureAtNode(name, Rule.FAILURE_STRING);
                        break;
                    case "take":
                        this.addFailureAtNode(name, Rule.FAILURE_STRING);
                        break;
                    case "pipe":
                        this.walkPipedOperators(parent);
                        break;
                    default:
                        break;
                    }
                }
            } else if (tsutils.isPropertyAccessExpression(parent)) {
                name = parent.name;
            } else {
                break;
            }
        }
    }

    private walkPatchedTypes(node: ts.CallExpression): void {

        this.walkPatchedOperators(node);
    }

    private walkPipedOperators(node: ts.CallExpression): void {
        node.arguments.forEach(arg => {
            if (tsutils.isCallExpression(arg)) {
                const { expression } = arg;
                if (tsutils.isIdentifier(expression) && ((expression.getText() === "first") || (expression.getText() === "take"))) {
                    this.addFailureAtNode(expression, Rule.FAILURE_STRING);
                }
            }
        });
    }

    private walkPipedTypes(node: ts.CallExpression): void {

        node.arguments.forEach(arg => {
            if (tsutils.isCallExpression(arg)) {
                const { expression } = arg;
                if (tsutils.isIdentifier(expression) && (expression.getText() === "ofType")) {
                    this.walkPipedOperators(node);
                }
            }
        });
    }
}
