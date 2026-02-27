import { render, screen } from '@testing-library/react'
import { Card, CardHeader, CardTitle, CardContent } from './card'

describe('Card component', () => {
  it('renders children inside the Card', () => {
    render(<Card>hello world</Card>)

    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders a title inside CardHeader', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>My Title</CardTitle>
        </CardHeader>
        <CardContent>content</CardContent>
      </Card>,
    )

    expect(screen.getByText('My Title')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
