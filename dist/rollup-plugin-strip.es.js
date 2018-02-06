import acorn from 'acorn';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import { createFilter } from 'rollup-pluginutils';

var whitespace = /\s/;

function getName ( node ) {
	if ( node.type === 'Identifier' ) { return node.name; }
	if ( node.type === 'ThisExpression' ) { return 'this'; }
	if ( node.type === 'Super' ) { return 'super'; }

	return null;
}

function flatten ( node ) {
	var name;
	var parts = [];

	while ( node.type === 'MemberExpression' ) {
		if ( node.computed ) { return null; }

		parts.unshift( node.property.name );
		node = node.object;
	}

	name = getName( node );

	if ( !name ) { return null; }

	parts.unshift( name );
	return parts.join( '.' );
}

function strip ( options ) {
	if ( options === void 0 ) options = {};

	var include = options.include || '**/*.js';
	var exclude = options.exclude;
	var filter = createFilter( include, exclude );
	var sourceMap = options.sourceMap !== false;

	var removeDebuggerStatements = options.debugger !== false;
	var functions = ( options.functions || [ 'console.*', 'assert.*' ] )
		.map( function (keypath) { return keypath.replace( /\./g, '\\.' ).replace( /\*/g, '\\w+' ); } );

	var firstpass = new RegExp( ("\\b(?:" + (functions.join( '|' )) + "|debugger)\\b") );
	var pattern = new RegExp( ("^(?:" + (functions.join( '|' )) + ")$") );

	return {
		name: 'strip',

		transform: function transform ( code, id ) {
			if ( !filter( id ) ) { return null; }
			if ( !firstpass.test( code ) ) { return null; }

			var ast;

			try {
				ast = acorn.parse( code, Object.assign( {
					ecmaVersion: 9,
					sourceType: 'module'
				}, options.acorn ) );
			} catch ( err ) {
				err.message += " in " + id;
				throw err;
			}

			var magicString = new MagicString( code );
			var edited = false;

			function remove ( start, end ) {
				while ( whitespace.test( code[ start - 1 ] ) ) { start -= 1; }
				magicString.remove( start, end );
			}
			
			function isBlock ( node ) {
				return node && ( node.type === 'BlockStatement' || node.type === 'Program' );
			}
			
			function removeExpression ( node ) {
				var parent = node.parent;

				if ( parent.type === 'ExpressionStatement' ) {
					removeStatement( parent );
				} else {
					magicString.overwrite( node.start, node.end, 'void 0' );
				}

				edited = true;
			}
			
			function removeStatement ( node ) {
				var parent = node.parent;

				if ( isBlock( parent ) ) {
					remove( node.start, node.end );
				} else {
					magicString.overwrite( node.start, node.end, 'void 0;' );
				}

				edited = true;
			}

			walk( ast, {
				enter: function enter ( node, parent ) {
					Object.defineProperty( node, 'parent', {
						value: parent,
						enumerable: false
					});

					if ( sourceMap ) {
						magicString.addSourcemapLocation( node.start );
						magicString.addSourcemapLocation( node.end );
					}

					if ( removeDebuggerStatements && node.type === 'DebuggerStatement' ) {
						removeStatement( node );
					}

					else if ( node.type === 'CallExpression' ) {
						var keypath = flatten( node.callee );
						if ( keypath && pattern.test( keypath ) ) {
							removeExpression( node );
							this.skip();
						}
					}
				}
			});

			if ( !edited ) { return null; }

			code = magicString.toString();
			var map = sourceMap ? magicString.generateMap() : null;

			return { code: code, map: map };
		}
	};
}

export default strip;
